import type { AutomationSchedule } from './types';

export const DEFAULT_MINIMUM_INTERVAL_MINUTES = 15;
export const MAX_CRON_LOOKAHEAD_DAYS = 370;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

type RRuleFrequency = 'MINUTELY' | 'HOURLY' | 'DAILY';

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCron {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

interface ParsedRRule {
  frequency: RRuleFrequency;
  interval: number;
  intervalMinutes: number;
}

export type ParsedAutomationSchedule =
  | { kind: 'manual'; timezone: string }
  | { kind: 'cron'; expression: string; timezone: string; cron: ParsedCron }
  | { kind: 'rrule'; expression: string; timezone: string; rrule: ParsedRRule };

export interface ScheduleError {
  code: string;
  message: string;
}

export type ScheduleResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ScheduleError };

type ScheduleFailure = { ok: false; error: ScheduleError };

export interface ScheduleCalculationOptions {
  minimumIntervalMinutes?: number;
  maxLookaheadDays?: number;
}

export function parseAutomationSchedule(
  schedule: AutomationSchedule,
): ScheduleResult<ParsedAutomationSchedule> {
  const timezone = schedule.timezone || 'UTC';
  if (!isValidTimeZone(timezone)) {
    return error('invalid_timezone', `Invalid schedule timezone: ${timezone}`);
  }

  if (!schedule.enabled || schedule.kind === 'manual') {
    return { ok: true, value: { kind: 'manual', timezone } };
  }

  const expression = schedule.expression?.trim();
  if (!expression) {
    return error('missing_expression', 'Schedule expression is required.');
  }

  if (schedule.kind === 'rrule') {
    const parsed = parseRRule(expression);
    if (isScheduleFailure(parsed)) return failure(parsed);
    return {
      ok: true,
      value: {
        kind: 'rrule',
        expression,
        timezone,
        rrule: parsed.value,
      },
    };
  }

  if (schedule.kind === 'cron') {
    const parsed = parseCron(expression);
    if (isScheduleFailure(parsed)) return failure(parsed);
    return {
      ok: true,
      value: {
        kind: 'cron',
        expression,
        timezone,
        cron: parsed.value,
      },
    };
  }

  return error('unsupported_schedule', `Unsupported schedule kind: ${schedule.kind}`);
}

export function calculateNextRunAt(
  schedule: AutomationSchedule,
  referenceAt: number,
  options: ScheduleCalculationOptions = {},
): ScheduleResult<number | null> {
  const parsed = parseAutomationSchedule(schedule);
  if (isScheduleFailure(parsed)) return failure(parsed);
  if (parsed.value.kind === 'manual') return { ok: true, value: null };

  const minimumIntervalMinutes = Math.max(
    DEFAULT_MINIMUM_INTERVAL_MINUTES,
    schedule.minimumIntervalMinutes,
    options.minimumIntervalMinutes ?? 0,
  );

  if (parsed.value.kind === 'rrule') {
    if (parsed.value.rrule.intervalMinutes < minimumIntervalMinutes) {
      return error(
        'schedule_too_frequent',
        `Schedule interval must be at least ${minimumIntervalMinutes} minutes.`,
      );
    }
    return {
      ok: true,
      value: referenceAt + parsed.value.rrule.intervalMinutes * MINUTE_MS,
    };
  }

  const first = findNextCronRun(parsed.value.cron, parsed.value.timezone, referenceAt, options);
  if (isScheduleFailure(first)) return failure(first);
  if (first.value == null) return first;

  const second = findNextCronRun(parsed.value.cron, parsed.value.timezone, first.value, options);
  if (!isScheduleFailure(second) && second.value != null) {
    const gapMinutes = (second.value - first.value) / MINUTE_MS;
    if (gapMinutes < minimumIntervalMinutes) {
      return error(
        'schedule_too_frequent',
        `Schedule interval must be at least ${minimumIntervalMinutes} minutes.`,
      );
    }
  }

  return first;
}

export function validateAutomationSchedule(
  schedule: AutomationSchedule,
  referenceAt: number = Date.now(),
  options: ScheduleCalculationOptions = {},
): ScheduleResult<ParsedAutomationSchedule> {
  const parsed = parseAutomationSchedule(schedule);
  if (isScheduleFailure(parsed)) return failure(parsed);
  const next = calculateNextRunAt(schedule, referenceAt, options);
  if (isScheduleFailure(next)) return failure(next);
  return parsed;
}

function parseRRule(expression: string): ScheduleResult<ParsedRRule> {
  const normalized = expression.replace(/^RRULE:/i, '');
  const parts = new Map<string, string>();

  for (const part of normalized.split(';')) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toUpperCase();
    const value = rawValue?.trim().toUpperCase();
    if (!key || !value) {
      return error('invalid_rrule', 'RRULE parts must use KEY=VALUE format.');
    }
    parts.set(key, value);
  }

  const frequency = parts.get('FREQ');
  if (!isRRuleFrequency(frequency)) {
    return error('invalid_rrule_frequency', 'RRULE FREQ must be MINUTELY, HOURLY, or DAILY.');
  }

  const intervalRaw = parts.get('INTERVAL') ?? '1';
  const interval = Number.parseInt(intervalRaw, 10);
  if (!Number.isInteger(interval) || interval < 1) {
    return error('invalid_rrule_interval', 'RRULE INTERVAL must be a positive integer.');
  }

  const unsupported = [...parts.keys()].filter((key) => key !== 'FREQ' && key !== 'INTERVAL');
  if (unsupported.length > 0) {
    return error('unsupported_rrule_part', `Unsupported RRULE part: ${unsupported.join(', ')}.`);
  }

  return {
    ok: true,
    value: {
      frequency,
      interval,
      intervalMinutes: intervalToMinutes(frequency, interval),
    },
  };
}

function parseCron(expression: string): ScheduleResult<ParsedCron> {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return error('invalid_cron', 'Cron expression must have 5 fields.');
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parsedMinute = parseCronField(minute, 0, 59);
  const parsedHour = parseCronField(hour, 0, 23);
  const parsedDayOfMonth = parseCronField(dayOfMonth, 1, 31);
  const parsedMonth = parseCronField(month, 1, 12);
  const parsedDayOfWeek = parseCronField(dayOfWeek, 0, 7, normalizeDayOfWeek);

  if (isScheduleFailure(parsedMinute)) return failure(parsedMinute);
  if (isScheduleFailure(parsedHour)) return failure(parsedHour);
  if (isScheduleFailure(parsedDayOfMonth)) return failure(parsedDayOfMonth);
  if (isScheduleFailure(parsedMonth)) return failure(parsedMonth);
  if (isScheduleFailure(parsedDayOfWeek)) return failure(parsedDayOfWeek);

  return {
    ok: true,
    value: {
      minute: parsedMinute.value,
      hour: parsedHour.value,
      dayOfMonth: parsedDayOfMonth.value,
      month: parsedMonth.value,
      dayOfWeek: parsedDayOfWeek.value,
    },
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): ScheduleResult<ParsedCronField> {
  const values = new Set<number>();
  const wildcard = field === '*' || field === '?';

  for (const token of field.split(',')) {
    const parsed = parseCronToken(token.trim(), min, max);
    if (isScheduleFailure(parsed)) return failure(parsed);
    for (let value = parsed.value.start; value <= parsed.value.end; value += parsed.value.step) {
      values.add(normalize(value));
    }
  }

  if (values.size === 0) {
    return error('invalid_cron_field', `Cron field "${field}" does not select any values.`);
  }

  return { ok: true, value: { values, wildcard } };
}

function parseCronToken(
  token: string,
  min: number,
  max: number,
): ScheduleResult<{ start: number; end: number; step: number }> {
  if (!token) return error('invalid_cron_field', 'Cron field contains an empty token.');

  const [rangePart, stepPart] = token.split('/');
  const step = stepPart == null ? 1 : Number.parseInt(stepPart, 10);
  if (!Number.isInteger(step) || step < 1) {
    return error('invalid_cron_step', `Invalid cron step "${stepPart}".`);
  }

  if (rangePart === '*' || rangePart === '?') {
    return { ok: true, value: { start: min, end: max, step } };
  }

  const [startRaw, endRaw] = rangePart.split('-');
  const start = Number.parseInt(startRaw, 10);
  const end = endRaw == null ? start : Number.parseInt(endRaw, 10);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
    return error('invalid_cron_range', `Invalid cron range "${rangePart}".`);
  }

  return { ok: true, value: { start, end, step } };
}

function findNextCronRun(
  cron: ParsedCron,
  timezone: string,
  referenceAt: number,
  options: ScheduleCalculationOptions,
): ScheduleResult<number | null> {
  const maxLookaheadMs = (options.maxLookaheadDays ?? MAX_CRON_LOOKAHEAD_DAYS) * DAY_MS;
  const endAt = referenceAt + maxLookaheadMs;
  let candidate = Math.floor(referenceAt / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

  while (candidate <= endAt) {
    if (matchesCron(cron, getZonedDateParts(candidate, timezone))) {
      return { ok: true, value: candidate };
    }
    candidate += MINUTE_MS;
  }

  return error('cron_no_next_run', 'No cron run was found within the lookahead window.');
}

function matchesCron(cron: ParsedCron, parts: ZonedDateParts): boolean {
  const dayOfMonthMatches = cron.dayOfMonth.values.has(parts.dayOfMonth);
  const dayOfWeekMatches = cron.dayOfWeek.values.has(parts.dayOfWeek);
  const dayMatches =
    !cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard
      ? dayOfMonthMatches || dayOfWeekMatches
      : dayOfMonthMatches && dayOfWeekMatches;

  return (
    cron.minute.values.has(parts.minute) &&
    cron.hour.values.has(parts.hour) &&
    cron.month.values.has(parts.month) &&
    dayMatches
  );
}

interface ZonedDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

function getZonedDateParts(timestamp: number, timezone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );

  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: weekdayToNumber(parts.weekday),
  };
}

function isRRuleFrequency(value: string | undefined): value is RRuleFrequency {
  return value === 'MINUTELY' || value === 'HOURLY' || value === 'DAILY';
}

function intervalToMinutes(frequency: RRuleFrequency, interval: number): number {
  if (frequency === 'MINUTELY') return interval;
  if (frequency === 'HOURLY') return interval * 60;
  return interval * 24 * 60;
}

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}

function weekdayToNumber(value: string | undefined): number {
  switch (value) {
    case 'Sun':
      return 0;
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    default:
      return 0;
  }
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function error<T = never>(code: string, message: string): ScheduleResult<T> {
  return { ok: false, error: { code, message } };
}

function failure<T>(result: ScheduleFailure): ScheduleResult<T> {
  return { ok: false, error: result.error };
}

function isScheduleFailure<T>(result: ScheduleResult<T>): result is ScheduleFailure {
  return result.ok === false;
}

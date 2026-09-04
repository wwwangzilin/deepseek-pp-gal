import type {
  UsageDailyModelSummary,
  UsageDailySummary,
  UsageHeatmapCell,
  UsageModelSummary,
  UsageRangeDays,
  UsageSummary,
  UsageTurnRecord,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeUsageRangeDays(value: unknown): UsageRangeDays {
  return value === 7 ? 7 : 30;
}

export function summarizeUsage(
  records: readonly UsageTurnRecord[],
  options: { rangeDays: UsageRangeDays; now?: number },
): UsageSummary {
  const now = normalizeTimestamp(options.now, Date.now());
  const rangeDays = normalizeUsageRangeDays(options.rangeDays);
  const dayKeys = getRecentDayKeys(rangeDays, now);
  const dayKeySet = new Set(dayKeys);
  const dailyBuckets = new Map(dayKeys.map((day) => [day, createDailyBucket(day)]));
  const modelBuckets = new Map<string, ModelBucket>();
  const sessions = new Set<string>();
  let totalTokens = 0;
  let messageCount = 0;
  let turnCount = 0;
  let serverTokenRecordCount = 0;

  for (const record of records) {
    if (!dayKeySet.has(record.day)) continue;

    const day = dailyBuckets.get(record.day);
    if (!day) continue;

    const tokens = normalizeCount(record.totalTokens);
    const messages = Math.max(0, Math.round(record.messageCount));
    const sessionKey = getRecordSessionKey(record);
    const modelKey = getUsageModelKey(record.modelType);
    const modelLabel = getUsageModelLabel(record.modelType);

    day.tokens += tokens;
    day.messageCount += messages;
    day.turnCount += 1;
    day.sessions.add(sessionKey);
    const dailyModel = day.models.get(modelKey) ?? {
      modelKey,
      modelLabel,
      tokens: 0,
    };
    dailyModel.tokens += tokens;
    day.models.set(modelKey, dailyModel);

    const model = modelBuckets.get(modelKey) ?? {
      modelKey,
      modelLabel,
      totalTokens: 0,
      turnCount: 0,
      messageCount: 0,
      sessions: new Set<string>(),
    };
    model.totalTokens += tokens;
    model.turnCount += 1;
    model.messageCount += messages;
    model.sessions.add(sessionKey);
    modelBuckets.set(modelKey, model);

    sessions.add(sessionKey);
    totalTokens += tokens;
    messageCount += messages;
    turnCount += 1;
    if (record.tokenSource === 'server') serverTokenRecordCount += 1;
  }

  const days = dayKeys.map((day) => toUsageDailySummary(dailyBuckets.get(day)!));
  const heatmap = createHeatmap(days);
  const modelUsage = [...modelBuckets.values()]
    .map((model): UsageModelSummary => ({
      modelKey: model.modelKey,
      modelLabel: model.modelLabel,
      totalTokens: model.totalTokens,
      turnCount: model.turnCount,
      messageCount: model.messageCount,
      sessionCount: model.sessions.size,
      share: totalTokens > 0 ? model.totalTokens / totalTokens : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.modelLabel.localeCompare(b.modelLabel));

  return {
    rangeDays,
    generatedAt: now,
    totalTokens,
    sessionCount: sessions.size,
    messageCount,
    turnCount,
    activeDays: days.filter((day) => day.tokens > 0).length,
    currentStreak: calculateCurrentStreak(days),
    serverTokenRecordCount,
    mostUsedModel: modelUsage[0] ?? null,
    days,
    heatmap,
    modelUsage,
  };
}

export function toLocalDayKey(timestamp: number): string {
  const date = new Date(normalizeTimestamp(timestamp, Date.now()));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dayKeyToTimestamp(day: string): number {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !date) return 0;
  return new Date(year, month - 1, date).getTime();
}

export function getUsageModelKey(modelType: string | null | undefined): string {
  const normalized = typeof modelType === 'string' ? modelType.trim() : '';
  return normalized ? normalized.toLowerCase() : 'deepseek-default';
}

export function getUsageModelLabel(modelType: string | null | undefined): string {
  const normalized = typeof modelType === 'string' ? modelType.trim() : '';
  const lower = normalized.toLowerCase();
  if (!lower || lower === 'default') return 'DeepSeek Chat';
  if (lower === 'expert') return 'DeepSeek Expert';
  if (lower === 'vision') return 'DeepSeek Vision';
  return normalized;
}

function getRecentDayKeys(rangeDays: UsageRangeDays, now: number): string[] {
  const today = dayKeyToTimestamp(toLocalDayKey(now));
  return Array.from({ length: rangeDays }, (_, index) => (
    toLocalDayKey(today - (rangeDays - index - 1) * DAY_MS)
  ));
}

function createHeatmap(days: readonly UsageDailySummary[]): UsageHeatmapCell[] {
  const maxTokens = Math.max(0, ...days.map((day) => day.tokens));
  return days.map((day) => ({
    day: day.day,
    timestamp: day.timestamp,
    tokens: day.tokens,
    level: getHeatLevel(day.tokens, maxTokens),
  }));
}

function getHeatLevel(tokens: number, maxTokens: number): UsageHeatmapCell['level'] {
  if (tokens <= 0 || maxTokens <= 0) return 0;
  return Math.max(1, Math.ceil((tokens / maxTokens) * 5)) as UsageHeatmapCell['level'];
}

function calculateCurrentStreak(days: readonly UsageDailySummary[]): number {
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].tokens <= 0) break;
    streak += 1;
  }
  return streak;
}

function createDailyBucket(day: string): DailyBucket {
  return {
    day,
    timestamp: dayKeyToTimestamp(day),
    tokens: 0,
    messageCount: 0,
    turnCount: 0,
    sessions: new Set<string>(),
    models: new Map<string, UsageDailyModelSummary>(),
  };
}

function toUsageDailySummary(bucket: DailyBucket): UsageDailySummary {
  return {
    day: bucket.day,
    timestamp: bucket.timestamp,
    tokens: bucket.tokens,
    messageCount: bucket.messageCount,
    sessionCount: bucket.sessions.size,
    turnCount: bucket.turnCount,
    models: [...bucket.models.values()].sort((a, b) => b.tokens - a.tokens),
  };
}

function getRecordSessionKey(record: UsageTurnRecord): string {
  return record.chatSessionId || `turn:${record.id}`;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function normalizeTimestamp(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

interface DailyBucket {
  day: string;
  timestamp: number;
  tokens: number;
  messageCount: number;
  turnCount: number;
  sessions: Set<string>;
  models: Map<string, UsageDailyModelSummary>;
}

interface ModelBucket {
  modelKey: string;
  modelLabel: string;
  totalTokens: number;
  turnCount: number;
  messageCount: number;
  sessions: Set<string>;
}

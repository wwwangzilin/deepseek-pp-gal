import {
  DEFAULT_LOCALE,
  translateArray,
  type LocaleArrayKey,
  type SupportedLocale,
} from '../i18n';

export type PetState =
  | 'idle'
  | 'thinking'
  | 'speaking'
  | 'working'
  | 'confused'
  | 'success'
  | 'error'
  | 'sleepy';

const PET_LINE_KEYS: Record<PetState, LocaleArrayKey> = {
  thinking: 'pet.lines.thinking',
  working: 'pet.lines.working',
  speaking: 'pet.lines.speaking',
  idle: 'pet.lines.idle',
  confused: 'pet.lines.confused',
  success: 'pet.lines.success',
  error: 'pet.lines.error',
  sleepy: 'pet.lines.sleepy',
};

export function getPetLines(
  state: PetState,
  locale: SupportedLocale = DEFAULT_LOCALE,
): readonly string[] {
  return translateArray(locale, PET_LINE_KEYS[state]);
}

export function pickPetLine(
  state: PetState,
  recent: readonly string[] = [],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const pool = getPetLines(state, locale);
  if (pool.length === 0) return '';

  const fresh = pool.filter((line) => !recent.includes(line));
  const candidates = fresh.length > 0 ? fresh : pool;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

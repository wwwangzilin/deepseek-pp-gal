import {
  DEFAULT_LOCALE_PREFERENCE,
  getBrowserLanguageCandidates,
  normalizeLocalePreference,
  resolveLocalePreference,
  type LocalePreference,
  type ResolvedLocaleState,
} from './runtime';

export const LOCALE_PREFERENCE_STORAGE_KEY = 'deepseek_pp_locale_preference';

export async function getLocalePreference(): Promise<LocalePreference> {
  const data = await chrome.storage.local.get(LOCALE_PREFERENCE_STORAGE_KEY) as Record<string, unknown>;
  return normalizeLocalePreference(data[LOCALE_PREFERENCE_STORAGE_KEY]);
}

export async function saveLocalePreference(preference: LocalePreference): Promise<LocalePreference> {
  const normalized = normalizeLocalePreference(preference);
  if (normalized === DEFAULT_LOCALE_PREFERENCE) {
    await chrome.storage.local.remove(LOCALE_PREFERENCE_STORAGE_KEY);
    return normalized;
  }
  await chrome.storage.local.set({ [LOCALE_PREFERENCE_STORAGE_KEY]: normalized });
  return normalized;
}

export async function getResolvedLocaleState(
  browserLanguages = getBrowserLanguageCandidates(),
): Promise<ResolvedLocaleState> {
  const preference = await getLocalePreference();
  return resolveLocalePreference(preference, browserLanguages);
}

export function watchLocalePreference(
  listener: (preference: LocalePreference) => void,
): () => void {
  const handleChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    if (!(LOCALE_PREFERENCE_STORAGE_KEY in changes)) return;
    listener(normalizeLocalePreference(changes[LOCALE_PREFERENCE_STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

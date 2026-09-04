import type { DeepSeekTheme } from '../types';

const STORAGE_KEY = 'deepseek_theme';

export async function getDeepSeekTheme(): Promise<DeepSeekTheme | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeDeepSeekTheme(data[STORAGE_KEY]);
}

export async function saveDeepSeekTheme(theme: DeepSeekTheme): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: theme });
}

function normalizeDeepSeekTheme(value: unknown): DeepSeekTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

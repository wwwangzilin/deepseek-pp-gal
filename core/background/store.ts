import type { BackgroundConfig } from '../types';
import { normalizeBackgroundConfig } from './config';

const STORAGE_KEY = 'deepseek_pp_background';

export async function getBackgroundConfig(): Promise<BackgroundConfig | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Partial<BackgroundConfig> | undefined>;
  return normalizeBackgroundConfig(data[STORAGE_KEY]);
}

export async function saveBackgroundConfig(config: BackgroundConfig): Promise<void> {
  const normalized = normalizeBackgroundConfig(config);
  if (!normalized) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

export async function clearBackgroundConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

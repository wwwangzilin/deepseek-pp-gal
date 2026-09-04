import type { PetConfig } from '../types';
import { normalizePetConfig } from './config';

const STORAGE_KEY = 'deepseek_pp_pet';

export async function getPetConfig(): Promise<PetConfig> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, Partial<PetConfig> | undefined>;
  return normalizePetConfig(data[STORAGE_KEY]);
}

export async function savePetConfig(config: PetConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizePetConfig(config) });
}

export async function clearPetConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

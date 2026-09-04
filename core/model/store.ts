import type { ModelType } from '../types';

const STORAGE_KEY = 'deepseek_pp_model_type';
const SUPPORTED_MODEL_TYPES = new Set<Exclude<ModelType, null>>(['expert', 'vision']);

export async function getModelType(): Promise<ModelType> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const value = data[STORAGE_KEY];
  return typeof value === 'string' && SUPPORTED_MODEL_TYPES.has(value as Exclude<ModelType, null>)
    ? value as Exclude<ModelType, null>
    : null;
}

export async function setModelType(modelType: ModelType): Promise<void> {
  if (modelType === null) {
    await chrome.storage.local.remove(STORAGE_KEY);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEY]: modelType });
  }
}

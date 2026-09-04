export const DEEPSEEK_API_KEY_STORAGE_KEY = 'deepseek_pp_official_api_key';

export async function getDeepSeekApiKey(): Promise<string | null> {
  const data = await chrome.storage.local.get(DEEPSEEK_API_KEY_STORAGE_KEY) as Record<string, unknown>;
  return normalizeApiKey(data[DEEPSEEK_API_KEY_STORAGE_KEY]);
}

export async function hasDeepSeekApiKey(): Promise<boolean> {
  return (await getDeepSeekApiKey()) !== null;
}

export async function saveDeepSeekApiKey(apiKey: string): Promise<void> {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error('DeepSeek API Key cannot be empty');
  }
  await chrome.storage.local.set({ [DEEPSEEK_API_KEY_STORAGE_KEY]: normalized });
}

export async function clearDeepSeekApiKey(): Promise<void> {
  await chrome.storage.local.remove(DEEPSEEK_API_KEY_STORAGE_KEY);
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

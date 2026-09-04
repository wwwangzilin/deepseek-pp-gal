// Storage for the global floating-chat ball toggle.
//
// The launcher is ON by default (key absent => true) so existing users see it
// after upgrade; users who explicitly turn it off stay off because the value
// is persisted as `false`.
const STORAGE_KEY = 'deepseek_pp_floating_chat_enabled';

export async function getFloatingChatEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  // Absent key => default ON.
  return data[STORAGE_KEY] !== false;
}

export async function setFloatingChatEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: enabled });
}

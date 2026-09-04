export interface VoiceSettings {
  inputEnabled: boolean;
  readAloudEnabled: boolean;
  rate: number;
  pitch: number;
}

export interface VoiceCapabilityState {
  speechRecognition: boolean;
  speechSynthesis: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputEnabled: false,
  readAloudEnabled: false,
  rate: 1,
  pitch: 1,
};

const STORAGE_KEY = 'deepseek_pp_voice_settings';

export async function getVoiceSettings(): Promise<VoiceSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeVoiceSettings(data[STORAGE_KEY]);
}

export async function saveVoiceSettings(settings: Partial<VoiceSettings>): Promise<VoiceSettings> {
  const current = await getVoiceSettings();
  const normalized = normalizeVoiceSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<VoiceSettings>
    : {};
  return {
    inputEnabled: object.inputEnabled === true,
    readAloudEnabled: object.readAloudEnabled === true,
    rate: clampNumber(object.rate, 0.5, 2, DEFAULT_VOICE_SETTINGS.rate),
    pitch: clampNumber(object.pitch, 0.5, 2, DEFAULT_VOICE_SETTINGS.pitch),
  };
}

export function detectVoiceCapabilities(target: unknown = globalThis): VoiceCapabilityState {
  const value = target && typeof target === 'object' ? target as Record<string, unknown> : {};
  return {
    speechRecognition: typeof value.SpeechRecognition === 'function' ||
      typeof value.webkitSpeechRecognition === 'function',
    speechSynthesis: Boolean(value.speechSynthesis),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

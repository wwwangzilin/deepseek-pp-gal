import { PRESET_REINJECTION_INTERVAL } from '../constants';
import { isSupportedLocale, type SupportedLocale } from '../i18n/background';

export type PromptPresetCadence = 'default' | 'first_message' | 'every_message' | 'off';
export type ForcedResponseLanguage = 'auto' | SupportedLocale;

export interface PromptInjectionSettings {
  memoryEnabled: boolean;
  systemPromptEnabled: boolean;
  presetCadence: PromptPresetCadence;
  forceResponseLanguage: ForcedResponseLanguage;
}

export const DEFAULT_PROMPT_INJECTION_SETTINGS: PromptInjectionSettings = {
  memoryEnabled: true,
  systemPromptEnabled: true,
  presetCadence: 'default',
  forceResponseLanguage: 'auto',
};

const STORAGE_KEY = 'deepseek_pp_prompt_injection_settings';

export async function getPromptInjectionSettings(): Promise<PromptInjectionSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizePromptInjectionSettings(data[STORAGE_KEY]);
}

export async function savePromptInjectionSettings(
  settings: Partial<PromptInjectionSettings>,
): Promise<PromptInjectionSettings> {
  const current = await getPromptInjectionSettings();
  const normalized = normalizePromptInjectionSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function normalizePromptInjectionSettings(value: unknown): PromptInjectionSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<PromptInjectionSettings>
    : {};
  return {
    memoryEnabled: object.memoryEnabled !== false,
    systemPromptEnabled: object.systemPromptEnabled !== false,
    presetCadence: normalizePresetCadence(object.presetCadence),
    forceResponseLanguage: normalizeForcedLanguage(object.forceResponseLanguage),
  };
}

export function shouldInjectPresetForTurn(input: {
  hasActivePreset: boolean;
  isFirstMessage: boolean;
  messageCount: number;
  cadence: PromptPresetCadence;
}): boolean {
  if (!input.hasActivePreset) return false;
  switch (input.cadence) {
    case 'off':
      return false;
    case 'first_message':
      return input.isFirstMessage;
    case 'every_message':
      return true;
    case 'default':
    default:
      return input.isFirstMessage || input.messageCount % PRESET_REINJECTION_INTERVAL === 0;
  }
}

function normalizePresetCadence(value: unknown): PromptPresetCadence {
  return value === 'first_message' ||
    value === 'every_message' ||
    value === 'off' ||
    value === 'default'
    ? value
    : DEFAULT_PROMPT_INJECTION_SETTINGS.presetCadence;
}

function normalizeForcedLanguage(value: unknown): ForcedResponseLanguage {
  if (value === 'auto') return 'auto';
  return isSupportedLocale(value) ? value : DEFAULT_PROMPT_INJECTION_SETTINGS.forceResponseLanguage;
}

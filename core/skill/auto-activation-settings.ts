// Local-skill "auto-activation" (implicit scoring) toggle settings.
//
// Two linked booleans:
//   firstMessage —— only the first message of a new conversation auto-matches and activates a local indexed skill;
//   everyMessage —— every message of the current conversation auto-matches and activates (when on, linked to also enable firstMessage).
//
// Invariant (enforced at the normalize layer so any UI / storage / runtime write stays consistent):
//   everyMessage ⇒ firstMessage (every-message on ⇒ first-message on);
//   not firstMessage ⇒ not everyMessage (first-message off ⇒ every-message off).
//
// This setting mirrors the "prompt injection settings" pathway in core/prompt/settings.ts:
// stored in chrome.storage.local, read via background's GET/SAVE commands,
// broadcast via STATE_UPDATED to content scripts, finally entering the request-augmentation state.

const STORAGE_KEY = 'deepseek_pp_skill_auto_activation';

export interface SkillAutoActivationSettings {
  firstMessage: boolean;
  everyMessage: boolean;
}

export const DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS: SkillAutoActivationSettings = {
  // Default first-message on: preserve the prior implicit-scoring behavior on the first message;
  // every-message off by default to avoid implicit scoring on every conversation turn.
  firstMessage: true,
  everyMessage: false,
};

export async function getSkillAutoActivationSettings(): Promise<SkillAutoActivationSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeSkillAutoActivationSettings(data[STORAGE_KEY]);
}

export async function saveSkillAutoActivationSettings(
  settings: Partial<SkillAutoActivationSettings>,
): Promise<SkillAutoActivationSettings> {
  const current = await getSkillAutoActivationSettings();
  const normalized = normalizeSkillAutoActivationSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function normalizeSkillAutoActivationSettings(value: unknown): SkillAutoActivationSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<SkillAutoActivationSettings>
    : null;
  if (!object) return { ...DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS };
  let everyMessage = object.everyMessage === true;
  let firstMessage = object.firstMessage === true;
  // Enforce invariant: every-message on ⇒ first-message on; first-message off ⇒ every-message off.
  if (everyMessage) firstMessage = true;
  if (!firstMessage) everyMessage = false;
  return { firstMessage, everyMessage };
}

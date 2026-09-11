import type { GalCharacter, GalCharacterCadence, GalSettings, NewGalCharacter } from '../types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

export const GAL_CHARACTER_SCHEMA_VERSION = 1 as const;
export const GAL_SETTINGS_STORAGE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_GAL_SETTINGS: GalSettings = {
  enabled: false,
  characterCadence: 'every_message',
  proactiveEnabled: false,
  proactiveIdleMinutes: 10,
};

export const galCharacterCollectionCodec: VersionedValueCodec<GalCharacter[]> = {
  decode(value) {
    return decodeGalCharacterCollection(value, 'galCharacters');
  },
  encode(value) {
    return decodeGalCharacterCollection(value, 'galCharacters');
  },
};

export const galSettingsCodec: VersionedValueCodec<GalSettings> = {
  decode(value) {
    return decodeGalSettings(value, 'galSettings');
  },
  encode(value) {
    return normalizeGalSettings(value, 'galSettings');
  },
};

export function decodeGalCharacterCollection(
  value: unknown,
  path = 'galCharacters',
): GalCharacter[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => decodeGalCharacter(item, `${path}[${index}]`));
}

export function decodeGalCharacter(value: unknown, path = 'galCharacter'): GalCharacter {
  const object = recordValue(value, path);
  const id = requiredNonEmptyString(object.id, `${path}.id`);
  const createdAt = finiteNumberOr(object.createdAt, `${path}.createdAt`, Date.now());
  const updatedAt = finiteNumberOr(object.updatedAt, `${path}.updatedAt`, createdAt);
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = object;
  return {
    ...rest,
    id,
    name: requiredNonEmptyString(object.name, `${path}.name`),
    color: optionalString(object.color, `${path}.color`),
    avatar: optionalString(object.avatar, `${path}.avatar`),
    description: optionalString(object.description, `${path}.description`),
    personality: optionalString(object.personality, `${path}.personality`),
    scenario: optionalString(object.scenario, `${path}.scenario`),
    exampleDialogue: optionalString(object.exampleDialogue, `${path}.exampleDialogue`),
    greeting: optionalString(object.greeting, `${path}.greeting`),
    systemPrompt: optionalString(object.systemPrompt, `${path}.systemPrompt`),
    memoryTags: optionalStringArray(object.memoryTags, `${path}.memoryTags`),
    affinity: optionalAffinity(object.affinity, `${path}.affinity`),
    createdAt,
    updatedAt,
  };
}

export function decodeGalSettings(value: unknown, path = 'galSettings'): GalSettings {
  return normalizeGalSettings(value, path);
}

export function normalizeGalSettings(value: unknown, path = 'galSettings'): GalSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const enabled = typeof object.enabled === 'boolean' ? object.enabled : DEFAULT_GAL_SETTINGS.enabled;
  const cadence = isGalCharacterCadence(object.characterCadence)
    ? object.characterCadence
    : DEFAULT_GAL_SETTINGS.characterCadence;
  const proactiveEnabled = typeof object.proactiveEnabled === 'boolean'
    ? object.proactiveEnabled
    : DEFAULT_GAL_SETTINGS.proactiveEnabled;
  const rawIdle = typeof object.proactiveIdleMinutes === 'number' && Number.isFinite(object.proactiveIdleMinutes)
    ? Math.round(object.proactiveIdleMinutes)
    : DEFAULT_GAL_SETTINGS.proactiveIdleMinutes as number;
  return {
    enabled,
    characterCadence: cadence,
    proactiveEnabled,
    proactiveIdleMinutes: Math.max(1, Math.min(240, rawIdle)),
  };
}

export function isGalCharacterCadence(value: unknown): value is GalCharacterCadence {
  return value === 'first_message' || value === 'every_message' || value === 'off';
}

export function normalizeCharacterInput(
  value: Record<string, unknown>,
  path = 'galCharacter',
): NewGalCharacter {
  return decodeGalCharacter({ ...value, createdAt: 0, updatedAt: 0 }, path);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be an array of strings`);
  }
  return [...value];
}

function finiteNumberOr(value: unknown, path: string, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined) return fallback;
  throw new Error(`${path} must be a finite number`);
}

/** Relationship value, clamped to 0-100. */
function optionalAffinity(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

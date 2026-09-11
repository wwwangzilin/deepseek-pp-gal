import type { GalGroup, NewGalGroup } from '../types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

export const GAL_GROUP_SCHEMA_VERSION = 1 as const;

export const galGroupCollectionCodec: VersionedValueCodec<GalGroup[]> = {
  decode(value) {
    return decodeGalGroupCollection(value, 'galGroups');
  },
  encode(value) {
    return decodeGalGroupCollection(value, 'galGroups');
  },
};

export function decodeGalGroupCollection(value: unknown, path = 'galGroups'): GalGroup[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => decodeGalGroup(item, `${path}[${index}]`));
}

export function decodeGalGroup(value: unknown, path = 'galGroup'): GalGroup {
  const object = recordValue(value, path);
  const id = requiredNonEmptyString(object.id, `${path}.id`);
  const createdAt = finiteNumberOr(object.createdAt, `${path}.createdAt`, Date.now());
  const updatedAt = finiteNumberOr(object.updatedAt, `${path}.updatedAt`, createdAt);
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = object;
  return {
    ...rest,
    id,
    name: requiredNonEmptyString(object.name, `${path}.name`),
    description: optionalString(object.description, `${path}.description`),
    instructions: optionalString(object.instructions, `${path}.instructions`),
    projectId: optionalString(object.projectId, `${path}.projectId`),
    memberIds: stringArray(object.memberIds, `${path}.memberIds`),
    createdAt,
    updatedAt,
  };
}

/** Loose decode for message payloads (id may be supplied by the caller). */
export function normalizeGalGroupInput(
  value: Record<string, unknown>,
  path = 'galGroup',
): NewGalGroup {
  return decodeGalGroup({
    memberIds: [],
    ...value,
    createdAt: 0,
    updatedAt: 0,
    id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id : makePendingGroupId(),
  }, path);
}

function makePendingGroupId(): string {
  return 'gal-group-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
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

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
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

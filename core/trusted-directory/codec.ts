import {
  TRUSTED_DIRECTORY_SCHEMA_VERSION,
  type TrustedDirectoryMeta,
} from './types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

/**
 * Strict, deterministic codec for the persisted trusted-directory summary.
 * Unknown future versions and corrupt values fail closed (never overwrite).
 */
export const trustedDirectoryCodec: VersionedValueCodec<TrustedDirectoryMeta | null> = {
  decode(value) {
    return value === null ? null : decodeTrustedDirectoryMeta(value);
  },
  encode(value) {
    return value === null ? null : decodeTrustedDirectoryMeta(value, 'trustedDirectory');
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`);
  }
  return value;
}

export function decodeTrustedDirectoryMeta(
  value: unknown,
  path = 'trustedDirectory',
): TrustedDirectoryMeta {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (value.schemaVersion !== TRUSTED_DIRECTORY_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  return {
    schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION,
    rootName: requiredString(value.rootName, `${path}.rootName`),
    pickedAt: finiteNumber(value.pickedAt, `${path}.pickedAt`),
    fileCount: finiteNumber(value.fileCount, `${path}.fileCount`),
    totalBytes: finiteNumber(value.totalBytes, `${path}.totalBytes`),
    skippedCount: finiteNumber(value.skippedCount, `${path}.skippedCount`),
    truncated: booleanValue(value.truncated, `${path}.truncated`),
  };
}

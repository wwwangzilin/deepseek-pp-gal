import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeTrustedDirectoryMeta } from '../core/trusted-directory/codec';
import {
  clearTrustedDirectoryMeta,
  getTrustedDirectoryMeta,
  saveTrustedDirectoryMeta,
  TRUSTED_DIRECTORY_STORAGE_KEY,
} from '../core/trusted-directory/store';
import { TRUSTED_DIRECTORY_SCHEMA_VERSION, type TrustedDirectoryMeta } from '../core/trusted-directory/types';

let storage: Record<string, unknown>;

const META: TrustedDirectoryMeta = {
  schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION,
  rootName: 'myproject',
  pickedAt: 1234,
  fileCount: 3,
  totalBytes: 1024,
  skippedCount: 1,
  truncated: false,
};

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trusted-directory persistence', () => {
  it('returns null before any authorization', async () => {
    await expect(getTrustedDirectoryMeta()).resolves.toBeNull();
  });

  it('round-trips the persisted summary', async () => {
    await saveTrustedDirectoryMeta(META);
    await expect(getTrustedDirectoryMeta()).resolves.toEqual(META);
    expect(storage[TRUSTED_DIRECTORY_STORAGE_KEY]).toEqual(META);
  });

  it('clears the persisted summary', async () => {
    await saveTrustedDirectoryMeta(META);
    await clearTrustedDirectoryMeta();
    await expect(getTrustedDirectoryMeta()).resolves.toBeNull();
    expect(storage[TRUSTED_DIRECTORY_STORAGE_KEY]).toBeNull();
  });

  it('rejects unsupported future schema versions without overwriting', async () => {
    storage[TRUSTED_DIRECTORY_STORAGE_KEY] = { ...META, schemaVersion: 99 };
    await expect(getTrustedDirectoryMeta()).rejects.toThrow(/schemaVersion/);
    expect((storage[TRUSTED_DIRECTORY_STORAGE_KEY] as { schemaVersion?: unknown }).schemaVersion).toBe(99);
  });

  it('rejects corrupt persisted values', async () => {
    storage[TRUSTED_DIRECTORY_STORAGE_KEY] = { schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION, rootName: 42 };
    await expect(getTrustedDirectoryMeta()).rejects.toThrow(/rootName/);
  });

  it('refuses to overwrite a corrupt slot when saving new metadata', async () => {
    storage[TRUSTED_DIRECTORY_STORAGE_KEY] = { schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION, rootName: 42 };
    await expect(saveTrustedDirectoryMeta(META)).rejects.toThrow(/rootName/);
    expect(storage[TRUSTED_DIRECTORY_STORAGE_KEY]).toEqual({
      schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION,
      rootName: 42,
    });
  });

  it('refuses to overwrite an unsupported future slot when saving new metadata', async () => {
    storage[TRUSTED_DIRECTORY_STORAGE_KEY] = { ...META, schemaVersion: 99 };
    await expect(saveTrustedDirectoryMeta(META)).rejects.toThrow(/schemaVersion/);
    expect((storage[TRUSTED_DIRECTORY_STORAGE_KEY] as { schemaVersion?: unknown }).schemaVersion).toBe(99);
  });
});

describe('decodeTrustedDirectoryMeta', () => {
  it('decodes a valid summary', () => {
    expect(decodeTrustedDirectoryMeta(META, 'test')).toEqual(META);
  });

  it('fails closed on non-object, missing version, or missing fields', () => {
    expect(() => decodeTrustedDirectoryMeta('nope', 'test')).toThrow(/object/);
    expect(() => decodeTrustedDirectoryMeta({}, 'test')).toThrow(/schemaVersion/);
    expect(() => decodeTrustedDirectoryMeta({ ...META, fileCount: 'x' }, 'test')).toThrow(/fileCount/);
    expect(() => decodeTrustedDirectoryMeta({ ...META, truncated: 1 }, 'test')).toThrow(/truncated/);
  });
});

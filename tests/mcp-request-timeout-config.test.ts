import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  MAX_MCP_REQUEST_TIMEOUT_MS,
  MIN_MCP_REQUEST_TIMEOUT_MS,
  MCP_REQUEST_TIMEOUT_STORAGE_KEY,
  clampMcpRequestTimeout,
  clearMcpRequestTimeoutMs,
  getMcpRequestTimeoutMs,
  saveMcpRequestTimeoutMs,
} from '../core/mcp/config';

function stubChromeStorageLocal(initial: Record<string, unknown> = {}) {
  let data = { ...initial };
  const get = vi.fn(async (key: string) => (
    Object.prototype.hasOwnProperty.call(data, key) ? { [key]: data[key] } : {}
  ));
  const set = vi.fn(async (values: Record<string, unknown>) => {
    data = { ...data, ...values };
  });
  const remove = vi.fn(async (key: string) => {
    delete data[key];
  });
  vi.stubGlobal('chrome', { storage: { local: { get, set, remove } } });
  return { get, set, remove, readTarget: () => data };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampMcpRequestTimeout', () => {
  it('returns the default for unset, non-numeric, and non-finite values', () => {
    expect(clampMcpRequestTimeout(undefined)).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    expect(clampMcpRequestTimeout(null)).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    expect(clampMcpRequestTimeout('120')).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    expect(clampMcpRequestTimeout(Number.NaN)).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });

  it('rounds to the nearest integer ms within the allowed range', () => {
    expect(clampMcpRequestTimeout(123_456.6)).toBe(123_457);
  });

  it('clamps into the [MIN, MAX] range', () => {
    expect(clampMcpRequestTimeout(0)).toBe(MIN_MCP_REQUEST_TIMEOUT_MS);
    expect(clampMcpRequestTimeout(MIN_MCP_REQUEST_TIMEOUT_MS - 1)).toBe(MIN_MCP_REQUEST_TIMEOUT_MS);
    expect(clampMcpRequestTimeout(MAX_MCP_REQUEST_TIMEOUT_MS + 100_000)).toBe(MAX_MCP_REQUEST_TIMEOUT_MS);
    // Non-finite values fall back to the default rather than the clamp bounds.
    expect(clampMcpRequestTimeout(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });

  it('preserves an in-range value', () => {
    expect(clampMcpRequestTimeout(300_000)).toBe(300_000);
  });
});

describe('getMcpRequestTimeoutMs', () => {
  it('falls back to the default when nothing is stored (fresh install)', async () => {
    stubChromeStorageLocal({});
    await expect(getMcpRequestTimeoutMs()).resolves.toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });

  it('returns the stored (clamped) value and never below MIN', async () => {
    stubChromeStorageLocal({ [MCP_REQUEST_TIMEOUT_STORAGE_KEY]: 30_000 });
    await expect(getMcpRequestTimeoutMs()).resolves.toBe(30_000);
  });

  it('falls back to the default when the storage API is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    await expect(getMcpRequestTimeoutMs()).resolves.toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });
});

describe('saveMcpRequestTimeoutMs', () => {
  it('persists a clamped value under the storage key', async () => {
    const { readTarget } = stubChromeStorageLocal({});
    await saveMcpRequestTimeoutMs(45_000);
    expect(readTarget()[MCP_REQUEST_TIMEOUT_STORAGE_KEY]).toBe(45_000);
  });

  it('clamps out-of-range writes before persisting', async () => {
    const { readTarget } = stubChromeStorageLocal({});
    await saveMcpRequestTimeoutMs(MAX_MCP_REQUEST_TIMEOUT_MS + 999_999);
    expect(readTarget()[MCP_REQUEST_TIMEOUT_STORAGE_KEY]).toBe(MAX_MCP_REQUEST_TIMEOUT_MS);
  });

  it('is a no-op when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    await expect(saveMcpRequestTimeoutMs(60_000)).resolves.toBeUndefined();
  });
});

describe('clearMcpRequestTimeoutMs', () => {
  it('removes the stored key', async () => {
    const { remove, readTarget } = stubChromeStorageLocal({
      [MCP_REQUEST_TIMEOUT_STORAGE_KEY]: 60_000,
    });
    await clearMcpRequestTimeoutMs();
    expect(remove).toHaveBeenCalledWith(MCP_REQUEST_TIMEOUT_STORAGE_KEY);
    expect(MCP_REQUEST_TIMEOUT_STORAGE_KEY in readTarget()).toBe(false);
  });
});

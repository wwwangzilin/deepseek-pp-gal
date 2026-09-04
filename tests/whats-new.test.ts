import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissWhatsNew,
  getWhatsNewState,
  hasPendingWhatsNew,
  markWhatsNewPending,
  shouldShowWhatsNew,
} from '../core/whats-new';

const LAST_SEEN_VERSION_KEY = 'deepseek_pp_whats_new_dismissed_version';
const PENDING_UPDATE_VERSION_KEY = 'deepseek_pp_whats_new_pending_version';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.0' })),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          if (typeof keys === 'string') {
            return { [keys]: storage[keys] };
          }
          return Object.fromEntries(
            Object.entries(keys).map(([key, defaultValue]) => [
              key,
              storage[key] ?? defaultValue,
            ]),
          );
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string | string[]) => {
          for (const item of Array.isArray(key) ? key : [key]) {
            delete storage[item];
          }
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whats-new state', () => {
  it('shows the current version until the user dismisses it', async () => {
    expect(await getWhatsNewState()).toEqual({
      version: '0.7.0',
      visible: true,
      pendingUpdate: false,
    });
    expect(await shouldShowWhatsNew()).toBe(true);

    await dismissWhatsNew();

    expect(storage[LAST_SEEN_VERSION_KEY]).toBe('0.7.0');
    expect(storage[PENDING_UPDATE_VERSION_KEY]).toBeUndefined();
    expect(await shouldShowWhatsNew()).toBe(false);
  });

  it('marks extension updates as pending until the current version is read', async () => {
    storage[LAST_SEEN_VERSION_KEY] = '0.6.5';

    await markWhatsNewPending('0.6.5');

    expect(storage[PENDING_UPDATE_VERSION_KEY]).toBe('0.7.0');
    expect(await hasPendingWhatsNew()).toBe(true);
    expect(await getWhatsNewState()).toMatchObject({
      visible: true,
      pendingUpdate: true,
    });

    await dismissWhatsNew();

    expect(storage[LAST_SEEN_VERSION_KEY]).toBe('0.7.0');
    expect(storage[PENDING_UPDATE_VERSION_KEY]).toBeUndefined();
    expect(await hasPendingWhatsNew()).toBe(false);
  });

  it('does not create a pending marker when the reported previous version is current', async () => {
    await markWhatsNewPending('0.7.0');

    expect(storage[PENDING_UPDATE_VERSION_KEY]).toBeUndefined();
    expect(await hasPendingWhatsNew()).toBe(false);
  });
});

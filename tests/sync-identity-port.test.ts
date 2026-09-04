import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEnv } from 'wxt';
import { getCurrentSyncIdentityPort } from '../core/sync/identity-port';
import { createManifest } from '../wxt.config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync identity port', () => {
  it('keeps Firefox Google Drive and OneDrive OAuth available from the generated manifest', async () => {
    const launchWebAuthFlow = vi.fn(async () => (
      'https://deepseek-pp.extensions.allizom.org/#code=firefox-authorization-code'
    ));
    const manifest = createManifest(firefoxBuildEnvironment());
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => manifest },
      identity: {
        getRedirectURL: () => 'https://deepseek-pp.extensions.allizom.org/',
        launchWebAuthFlow,
      },
    });

    const identity = getCurrentSyncIdentityPort();

    expect(identity?.getRedirectUri()).toBe('https://deepseek-pp.extensions.allizom.org/');
    await expect(identity?.launchWebAuthFlow({
      url: 'https://accounts.example.test/auth',
      interactive: true,
    })).resolves.toContain('firefox-authorization-code');
    expect(launchWebAuthFlow).toHaveBeenCalledOnce();
  });
});

function firefoxBuildEnvironment(): ConfigEnv {
  return {
    mode: 'production',
    command: 'build',
    browser: 'firefox',
    manifestVersion: 3,
  };
}

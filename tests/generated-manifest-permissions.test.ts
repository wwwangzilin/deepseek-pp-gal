import { describe, expect, it } from 'vitest';
import type { ConfigEnv, TargetBrowser } from 'wxt';
import { createManifest } from '../wxt.config';

const CHROMIUM_PERMISSIONS = [
  'storage',
  'alarms',
  'nativeMessaging',
  'contextMenus',
  'offscreen',
  'debugger',
  'tabs',
  'identity',
  'sidePanel',
];

const FIREFOX_PERMISSIONS = [
  'storage',
  'alarms',
  'nativeMessaging',
  'contextMenus',
  'identity',
];

describe('generated PC browser manifest permissions', () => {
  it('keeps Chrome and Edge unchanged while granting Firefox cloud-sync identity', () => {
    expect(manifestPermissions('chrome')).toEqual(CHROMIUM_PERMISSIONS);
    expect(manifestPermissions('edge')).toEqual(CHROMIUM_PERMISSIONS);
    expect(manifestPermissions('firefox')).toEqual(FIREFOX_PERMISSIONS);
  });

  it('does not infer or declare downloads for any supported browser', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      expect(manifestPermissions(browser)).not.toContain('downloads');
    }
  });
});

function manifestPermissions(browser: TargetBrowser): string[] {
  return createManifest(createBuildEnvironment(browser)).permissions ?? [];
}

function createBuildEnvironment(browser: TargetBrowser): ConfigEnv {
  return {
    mode: 'production',
    command: 'build',
    browser,
    manifestVersion: 3,
  };
}

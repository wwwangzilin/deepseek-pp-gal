export const PLATFORM_CAPABILITY_KEYS = [
  'storage',
  'runtimeMessaging',
  'downloads',
  'filePicker',
  'folderPicker',
  'assetUrl',
  'sidePanel',
  'nativeMessaging',
  'contextMenus',
  'alarms',
  'tabs',
  'tabGroups',
  'debugger',
  'browserControl',
  'accessibilityTree',
] as const;

export const PLATFORM_PROFILE_FIXTURES = {
  chromium: {
    supported: PLATFORM_CAPABILITY_KEYS.filter((capability) => capability !== 'downloads'),
    unsupported: ['downloads'],
  },
  firefox: {
    supported: ['storage', 'runtimeMessaging', 'assetUrl', 'nativeMessaging', 'contextMenus', 'alarms'],
    unsupported: ['downloads', 'filePicker', 'folderPicker', 'sidePanel', 'tabs', 'tabGroups', 'debugger', 'browserControl', 'accessibilityTree'],
  },
} as const;

export const PLATFORM_CURRENT_GAPS = [] as const;

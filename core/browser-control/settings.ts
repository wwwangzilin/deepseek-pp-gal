import {
  BROWSER_CONTROL_STORAGE_KEY,
  type BrowserControlSettings,
} from './types';

export const DEFAULT_BROWSER_CONTROL_SETTINGS: BrowserControlSettings = {
  enabled: false,
  targetTabId: null,
  includeSnapshotAfterActions: true,
  maxSnapshotNodes: 400,
  maxSnapshotTextBytes: 24_000,
};

const MIN_SNAPSHOT_NODES = 50;
const MAX_SNAPSHOT_NODES = 1_500;
const MIN_SNAPSHOT_TEXT_BYTES = 4_000;
const MAX_SNAPSHOT_TEXT_BYTES = 80_000;

export function normalizeBrowserControlSettings(input: unknown): BrowserControlSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_BROWSER_CONTROL_SETTINGS };
  }

  const partial = input as Partial<BrowserControlSettings>;
  return {
    enabled: partial.enabled === true,
    targetTabId: typeof partial.targetTabId === 'number' && Number.isInteger(partial.targetTabId)
      ? partial.targetTabId
      : null,
    includeSnapshotAfterActions: partial.includeSnapshotAfterActions !== false,
    maxSnapshotNodes: clampInteger(
      partial.maxSnapshotNodes,
      DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotNodes,
      MIN_SNAPSHOT_NODES,
      MAX_SNAPSHOT_NODES,
    ),
    maxSnapshotTextBytes: clampInteger(
      partial.maxSnapshotTextBytes,
      DEFAULT_BROWSER_CONTROL_SETTINGS.maxSnapshotTextBytes,
      MIN_SNAPSHOT_TEXT_BYTES,
      MAX_SNAPSHOT_TEXT_BYTES,
    ),
  };
}

export async function getBrowserControlSettings(): Promise<BrowserControlSettings> {
  const data = await chrome.storage.local.get(BROWSER_CONTROL_STORAGE_KEY) as Record<string, unknown>;
  return normalizeBrowserControlSettings(data[BROWSER_CONTROL_STORAGE_KEY]);
}

export async function saveBrowserControlSettings(
  patch: Partial<BrowserControlSettings>,
): Promise<BrowserControlSettings> {
  const current = await getBrowserControlSettings();
  const next = normalizeBrowserControlSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [BROWSER_CONTROL_STORAGE_KEY]: next });
  return next;
}

export async function setBrowserControlEnabled(enabled: boolean): Promise<BrowserControlSettings> {
  return saveBrowserControlSettings({ enabled });
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

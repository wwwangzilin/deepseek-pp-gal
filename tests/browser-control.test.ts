import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserControlToolDescriptors,
  shouldExposeBrowserControlTools,
} from '../core/browser-control/tool';
import {
  BrowserControlService,
  getBrowserControlElementPoint,
} from '../core/browser-control/service';
import {
  DEFAULT_BROWSER_CONTROL_SETTINGS,
  normalizeBrowserControlSettings,
} from '../core/browser-control/settings';
import { BROWSER_CONTROL_STORAGE_KEY } from '../core/browser-control/types';
import { formatAccessibilitySnapshot } from '../core/browser-control/snapshot';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser control settings and descriptors', () => {
  it('normalizes settings with browser control disabled by default', () => {
    const settings = normalizeBrowserControlSettings({
      enabled: true,
      targetTabId: 12,
      includeSnapshotAfterActions: false,
      maxSnapshotNodes: 10_000,
      maxSnapshotTextBytes: 1,
    });

    expect(normalizeBrowserControlSettings(null)).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
    expect(settings).toMatchObject({
      enabled: true,
      targetTabId: 12,
      includeSnapshotAfterActions: false,
      maxSnapshotNodes: 1500,
      maxSnapshotTextBytes: 4000,
    });
  });

  it('exposes the full browser tool set only after explicit enablement', async () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('chrome', createChromeStub(storage));

    expect(await shouldExposeBrowserControlTools()).toBe(false);

    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
    });

    expect(await shouldExposeBrowserControlTools()).toBe(true);
    expect(createBrowserControlToolDescriptors('en').map((tool) => tool.name)).toEqual([
      'browser_navigate',
      'browser_go_back',
      'browser_go_forward',
      'browser_refresh',
      'browser_list_tabs',
      'browser_select_tab',
      'browser_close_tab',
      'browser_snapshot',
      'browser_click',
      'browser_hover',
      'browser_fill',
      'browser_fill_form',
      'browser_key',
      'browser_type',
      'browser_attach_file',
      'browser_wait_for',
      'browser_handle_dialog',
      'browser_evaluate_script',
    ]);
  });
});

describe('browser accessibility snapshot formatter', () => {
  it('formats AX nodes with stable element ids and backend node mapping', () => {
    const snapshot = formatAccessibilitySnapshot({
      url: 'https://example.com/',
      title: 'Example',
      maxNodes: 20,
      maxTextBytes: 4000,
      axNodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 42 },
      ],
    });

    expect(snapshot.result.text).toContain('URL: https://example.com/');
    expect(snapshot.result.text).toContain('[e2] button "Submit"');
    expect(snapshot.uidToBackendNodeId.get('e2')).toBe(42);
  });

  it('truncates snapshots by node and text budgets', () => {
    const snapshot = formatAccessibilitySnapshot({
      url: 'https://example.com/',
      title: 'Example',
      maxNodes: 1,
      maxTextBytes: 200,
      axNodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example' }, childIds: ['2'] },
        { nodeId: '2', role: { value: 'button' }, name: { value: 'Second' }, backendDOMNodeId: 43 },
      ],
    });

    expect(snapshot.result.nodes).toHaveLength(1);
    expect(snapshot.result.truncated).toBe(true);
    expect(snapshot.result.text).toContain('...[snapshot truncated]');
  });
});

describe('browser element point calculation', () => {
  it('scrolls offscreen elements into view before returning a click point', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    let scrolled = false;
    button.scrollIntoView = vi.fn(() => {
      scrolled = true;
    });
    button.getBoundingClientRect = vi.fn(() => scrolled
      ? createRect({ left: 20, top: 100, width: 80, height: 40 })
      : createRect({ left: 20, top: 1200, width: 80, height: 40 }));

    const point = await getBrowserControlElementPoint.call(button);

    expect(button.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'center',
      behavior: 'auto',
    });
    expect(point).toMatchObject({
      x: 60,
      y: 120,
      width: 80,
      height: 40,
      visible: true,
    });
  });
});

describe('browser navigation tool', () => {
  it('lists tabs when tabGroups is blocked by the browser', async () => {
    const storage = new Map<string, unknown>();
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'Example', url: 'https://example.com/' }),
    ]);
    Object.defineProperty(chromeStub, 'tabGroups', {
      get() {
        throw new Error("'tabGroups' is not allowed for specified extension ID.");
      },
    });
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const state = await service.getState();

    expect(state.supported).toBe(true);
    expect(state.targets).toHaveLength(1);
    expect(state.targets[0]).toMatchObject({
      id: 12,
      title: 'Example',
      groupName: undefined,
    });
  });

  it('opens a new tab by default so the chat tab is not replaced', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const result = await service.execute('browser_navigate', { url: 'https://example.com/' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      tabId: 100,
      url: 'https://example.com/',
      newTab: true,
    });
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/', active: true });
    expect(chromeStub.debugger.attach).not.toHaveBeenCalled();
    expect(chromeStub.debugger.sendCommand).not.toHaveBeenCalledWith(
      expect.anything(),
      'Page.navigate',
      expect.anything(),
    );
    await expect(chromeStub.tabs.get(12)).resolves.toMatchObject({
      url: 'https://chat.deepseek.com/a/chat/s/current',
    });
    await expect(chromeStub.storage.local.get(BROWSER_CONTROL_STORAGE_KEY)).resolves.toMatchObject({
      [BROWSER_CONTROL_STORAGE_KEY]: expect.objectContaining({ targetTabId: 100 }),
    });
  });

  it('can still replace the selected tab when newTab is explicitly false', async () => {
    const storage = new Map<string, unknown>();
    storage.set(BROWSER_CONTROL_STORAGE_KEY, {
      ...DEFAULT_BROWSER_CONTROL_SETTINGS,
      enabled: true,
      targetTabId: 12,
      includeSnapshotAfterActions: false,
    });
    const chromeStub = createChromeStub(storage, [
      createTab({ id: 12, active: true, title: 'DeepSeek', url: 'https://chat.deepseek.com/a/chat/s/current' }),
    ]);
    vi.stubGlobal('chrome', chromeStub);

    const service = new BrowserControlService({ chromeApi: chromeStub as unknown as typeof chrome });
    const result = await service.execute('browser_navigate', {
      url: 'https://example.com/',
      newTab: false,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      tabId: 12,
      url: 'https://example.com/',
      newTab: false,
    });
    expect(chromeStub.tabs.create).not.toHaveBeenCalled();
    expect(chromeStub.debugger.attach).toHaveBeenCalledWith({ tabId: 12 }, '1.3');
    expect(chromeStub.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      'Page.navigate',
      { url: 'https://example.com/' },
    );
    await expect(chromeStub.tabs.get(12)).resolves.toMatchObject({
      url: 'https://example.com/',
    });
  });
});

function createTab(overrides: Partial<chrome.tabs.Tab> & { id: number }): chrome.tabs.Tab {
  return {
    id: overrides.id,
    windowId: overrides.windowId ?? 1,
    groupId: overrides.groupId ?? -1,
    active: overrides.active ?? false,
    title: overrides.title ?? '',
    url: overrides.url ?? 'about:blank',
    pendingUrl: overrides.pendingUrl,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    discarded: false,
    frozen: false,
    autoDiscardable: true,
  };
}

function createRect(input: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  const { left, top, width, height } = input;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => input,
  } as DOMRect;
}

function createChromeStub(
  storage: Map<string, unknown>,
  initialTabs: chrome.tabs.Tab[] = [],
) {
  let nextTabId = 100;
  let attachedTabId: number | null = null;
  const tabs = new Map<number, chrome.tabs.Tab>(
    initialTabs.map((tab) => [tab.id!, { ...tab }]),
  );

  return {
    runtime: {
      id: 'extension-id',
      sendMessage: vi.fn(),
      getURL: vi.fn(),
      connectNative: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, storedValue] of Object.entries(value)) storage.set(key, storedValue);
        }),
      },
    },
    debugger: {
      attach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        attachedTabId = source.tabId ?? null;
      }),
      detach: vi.fn(async (source: chrome.debugger.Debuggee) => {
        if (source.tabId === attachedTabId) attachedTabId = null;
      }),
      sendCommand: vi.fn(async (
        source: chrome.debugger.Debuggee,
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (source.tabId !== attachedTabId) throw new Error('No tab is attached.');
        if (method === 'Page.navigate' && typeof params?.url === 'string') {
          const tab = tabs.get(source.tabId);
          if (tab) tab.url = params.url;
        }
        return {};
      }),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo = {}) => {
        let result = Array.from(tabs.values());
        if (queryInfo.active === true) {
          result = result.filter((tab) => tab.active);
        }
        if (queryInfo.currentWindow === true) {
          result = result.filter((tab) => tab.windowId === 1);
        }
        return result.map((tab) => ({ ...tab }));
      }),
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        return { ...tab };
      }),
      create: vi.fn(async (options: chrome.tabs.CreateProperties) => {
        const tab = createTab({
          id: nextTabId++,
          active: options.active === true,
          url: options.url ?? 'about:blank',
        });
        if (tab.active) {
          for (const existing of tabs.values()) {
            existing.active = false;
          }
        }
        tabs.set(tab.id!, tab);
        return { ...tab };
      }),
      update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id ${tabId}`);
        if (properties.active === true) {
          for (const existing of tabs.values()) {
            existing.active = false;
          }
          tab.active = true;
        }
        if (typeof properties.url === 'string') {
          tab.url = properties.url;
        }
        return { ...tab };
      }),
      remove: vi.fn(async (tabId: number) => {
        tabs.delete(tabId);
      }),
    },
    tabGroups: {
      query: vi.fn(),
    },
  };
}

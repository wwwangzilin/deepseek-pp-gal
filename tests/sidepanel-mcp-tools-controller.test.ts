import { describe, expect, it, vi } from 'vitest';
import type { McpServerConfig, McpToolCacheEntry, ToolDescriptor } from '../core/types';
import {
  McpPermissionError,
  createMcpToolsController,
  createPythonToolTogglePatch,
  getAllowedMcpTransportKinds,
  isMcpNativeMessagingSupported,
  isMcpToolEnabled,
  isMcpToolSelected,
  nextMcpToolAllowlist,
  normalizeHostPermissionOrigin,
} from '../entrypoints/sidepanel/controllers/mcp-tools-controller';
import { createSidepanelRuntimeClient } from '../entrypoints/sidepanel/runtime-client';

describe('sidepanel MCP and Tools controller', () => {
  it('loads one validated snapshot through typed runtime requests', async () => {
    const requests: unknown[] = [];
    const controller = createMcpToolsController(createSidepanelRuntimeClient(async (request) => {
      requests.push(request);
      if (request.type === 'GET_MCP_SERVERS') return [server];
      if (request.type === 'GET_PLATFORM_CAPABILITIES') return platform;
      if (request.type === 'GET_MCP_TOOL_CACHE') return null;
      if (request.type === 'GET_TOOL_CALL_HISTORY') return [];
      if (request.type === 'GET_MCP_CAPABILITY_SETTINGS') return capabilitySettings;
      throw new Error(`Unexpected command: ${request.type}`);
    }));

    await expect(controller.loadMcpSnapshot()).resolves.toMatchObject({
      servers: [server],
      caches: { 'server-1': null },
      history: [],
      platform,
      capabilitySettings,
    });
    expect(requests).toEqual(expect.arrayContaining([
      { type: 'GET_MCP_SERVERS' },
      { type: 'GET_PLATFORM_CAPABILITIES' },
      { type: 'GET_MCP_TOOL_CACHE', payload: { serverId: 'server-1' } },
      { type: 'GET_TOOL_CALL_HISTORY', payload: { limit: 12 } },
      { type: 'GET_MCP_CAPABILITY_SETTINGS' },
    ]));
  });

  it('uses the typed capability exposure setting command and preserves a copied pin list', async () => {
    const sendMessage = vi.fn(async (request: { type: string; payload?: unknown }) => {
      if (request.type === 'SET_MCP_CAPABILITY_SERVER_EXPOSURE') return {
        ...capabilitySettings,
        servers: {
          'server-1': { mode: 'adaptive', pinnedDescriptorIds: ['tool-1'] },
        },
      };
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const controller = createMcpToolsController(createSidepanelRuntimeClient(sendMessage));
    const pins = ['tool-1'] as const;

    await expect(controller.setServerExposure({
      serverId: 'server-1',
      mode: 'adaptive',
      pinnedDescriptorIds: pins,
    })).resolves.toMatchObject({
      servers: { 'server-1': { mode: 'adaptive', pinnedDescriptorIds: ['tool-1'] } },
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_MCP_CAPABILITY_SERVER_EXPOSURE',
      payload: { serverId: 'server-1', mode: 'adaptive', pinnedDescriptorIds: ['tool-1'] },
    });
  });

  it('updates the shared adaptive prompt budget through the typed settings command', async () => {
    const sendMessage = vi.fn(async (request: { type: string; payload?: unknown }) => {
      if (request.type === 'UPDATE_MCP_CAPABILITY_SETTINGS') return {
        ...capabilitySettings,
        adaptiveMaxDirectTools: 12,
        adaptiveMaxPromptBytes: 48_000,
      };
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const controller = createMcpToolsController(createSidepanelRuntimeClient(sendMessage));

    await expect(controller.updateCapabilitySettings({
      adaptiveMaxDirectTools: 12,
      adaptiveMaxPromptBytes: 48_000,
    })).resolves.toMatchObject({
      adaptiveMaxDirectTools: 12,
      adaptiveMaxPromptBytes: 48_000,
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_MCP_CAPABILITY_SETTINGS',
      payload: { adaptiveMaxDirectTools: 12, adaptiveMaxPromptBytes: 48_000 },
    });
  });

  it('owns permission-before-connect policy and does not retry after denial', async () => {
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === 'REFRESH_MCP_SERVER_TOOLS') return cache;
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const permissions = { request: vi.fn(async () => false) };
    const controller = createMcpToolsController(
      createSidepanelRuntimeClient(sendMessage),
      permissions,
    );

    await expect(controller.connectServer(server, 'refresh')).rejects.toMatchObject({
      name: 'McpPermissionError',
      origin: 'https://example.test/*',
    } satisfies Partial<McpPermissionError>);
    expect(permissions.request).toHaveBeenCalledWith(['https://example.test/*']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('requests MCP permission directly from the sidepanel before refreshing tools', async () => {
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === 'REFRESH_MCP_SERVER_TOOLS') return cache;
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const permissions = { request: vi.fn(async () => true) };
    const controller = createMcpToolsController(
      createSidepanelRuntimeClient(sendMessage),
      permissions,
    );

    await expect(controller.connectServer(server, 'refresh')).resolves.toEqual(cache);
    expect(permissions.request).toHaveBeenCalledWith(['https://example.test/*']);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'REFRESH_MCP_SERVER_TOOLS',
      payload: { serverId: server.id },
    });
  });

  it('requests host permission directly from the sidepanel click boundary', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Host permission requests must not cross the runtime bridge.');
    });
    const permissions = {
      request: vi.fn(async () => true),
    };
    const controller = createMcpToolsController(
      createSidepanelRuntimeClient(sendMessage),
      permissions,
    );

    await expect(controller.requestHostPermission([
      'http://*/*',
      'https://*/*',
    ])).resolves.toBe(true);
    expect(permissions.request).toHaveBeenCalledWith(['http://*/*', 'https://*/*']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('centralizes tool allowlist and Python provider policy', () => {
    expect(isMcpToolEnabled(server, pythonTool)).toBe(true);
    expect(nextMcpToolAllowlist(server.allowlist, pythonTool, false)).toEqual({
      mode: 'deny',
      toolNames: ['python_exec'],
    });
    expect(createPythonToolTogglePatch(server, pythonTool)).toMatchObject({
      allowlist: { mode: 'deny', toolNames: ['python_exec'] },
    });
    expect(normalizeHostPermissionOrigin('https://example.test/path?q=1'))
      .toBe('https://example.test/*');
    expect(() => normalizeHostPermissionOrigin('file:///tmp/data'))
      .toThrow('only supports http/https');
  });

  it('keeps allowlist selection independent of execution policy for disabled-mode toggles', () => {
    const disabledModeServer: McpServerConfig = {
      ...server,
      execution: { enabled: true, mode: 'disabled' },
    };
    const disabledServer: McpServerConfig = {
      ...server,
      enabled: false,
      execution: { enabled: true, mode: 'disabled' },
    };

    expect(isMcpToolEnabled(disabledModeServer, pythonTool)).toBe(false);
    expect(isMcpToolSelected(disabledModeServer, pythonTool)).toBe(true);
    expect(isMcpToolSelected(disabledServer, pythonTool)).toBe(true);

    const off = nextMcpToolAllowlist(
      disabledModeServer.allowlist,
      pythonTool,
      !isMcpToolSelected(disabledModeServer, pythonTool),
    );
    expect(off).toEqual({ mode: 'deny', toolNames: ['python_exec'] });
    expect(isMcpToolSelected({ ...disabledModeServer, allowlist: off }, pythonTool)).toBe(false);

    const backOn = nextMcpToolAllowlist(off, pythonTool, !isMcpToolSelected(
      { ...disabledModeServer, allowlist: off },
      pythonTool,
    ));
    expect(backOn).toEqual({ mode: 'all', toolNames: [] });
    expect(isMcpToolSelected({ ...disabledModeServer, allowlist: backOn }, pythonTool)).toBe(true);
  });

  it('deselects an allow-listed tool in disabled mode instead of only ever enabling', () => {
    const disabledModeServer: McpServerConfig = {
      ...server,
      execution: { enabled: true, mode: 'disabled' },
      allowlist: { mode: 'allow', toolNames: ['python_exec'] },
    };

    expect(isMcpToolEnabled(disabledModeServer, pythonTool)).toBe(false);
    expect(isMcpToolSelected(disabledModeServer, pythonTool)).toBe(true);

    const next = nextMcpToolAllowlist(
      disabledModeServer.allowlist,
      pythonTool,
      !isMcpToolSelected(disabledModeServer, pythonTool),
    );
    expect(next).toEqual({ mode: 'allow', toolNames: [] });
  });

  it('keeps native controls disabled until the platform snapshot loads', () => {
    expect(isMcpNativeMessagingSupported(null)).toBe(false);
    expect(getAllowedMcpTransportKinds(['streamable_http', 'native_messaging'], null))
      .toEqual(['streamable_http']);
  });
});

const server: McpServerConfig = {
  version: 1,
  id: 'server-1',
  displayName: 'Example MCP',
  enabled: true,
  transport: { kind: 'http', url: 'https://example.test/mcp' },
  headers: [],
  secrets: [],
  timeouts: { connectMs: 10_000, requestMs: 60_000, discoveryMs: 20_000 },
  limits: { maxResultBytes: 64_000, maxToolCount: 128 },
  allowlist: { mode: 'all', toolNames: [] },
  execution: { mode: 'auto', enabled: true },
  status: 'ready',
  lastConnectedAt: 1_000,
  lastError: null,
  createdAt: 1,
  updatedAt: 2,
};

const cache: McpToolCacheEntry = {
  serverId: server.id,
  descriptors: [],
  refreshedAt: 1_000,
  expiresAt: 2_000,
  health: {
    serverId: server.id,
    status: 'ready',
    checkedAt: 1_000,
    latencyMs: 10,
    toolCount: 0,
    error: null,
  },
};

const pythonTool = {
  id: 'tool-1',
  name: 'python_exec',
  invocationName: 'python_exec',
} as ToolDescriptor;

const platform = {
  kind: 'browser_extension',
  name: 'WebExtension',
  capabilities: { nativeMessaging: true },
};

const capabilitySettings = {
  version: 1,
  adaptiveMaxDirectTools: 8,
  adaptiveMaxPromptBytes: 24_000,
  servers: {},
};

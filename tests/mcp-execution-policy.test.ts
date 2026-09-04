import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_PROTOCOL_VERSION } from '../core/mcp';
import { createMcpDescriptorId, createMcpInvocationName } from '../core/mcp/descriptor-identity';
import { executeMcpToolCall, getMcpToolDescriptors, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import {
  createMcpServer,
  getMcpServerById,
  getMcpToolCache,
  saveMcpToolCache,
  updateMcpServer,
} from '../core/mcp/store';
import { MCP_STORAGE_KEY } from '../core/mcp/storage-codec';
import { renderToolSchemas } from '../core/prompt/augmentation';
import type { McpServerConfig, ToolCall, ToolDescriptor } from '../core/types';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    storage = { ...storage, ...values };
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: storageSet,
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.0.0' })),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP execution policy', () => {
  it('rejects tool calls before discovery when server execution is disabled', async () => {
    const server = await createMcpServer({
      displayName: 'Disabled Execution MCP',
      enabled: true,
      transport: {
        kind: 'native_messaging',
        nativeHost: 'com.example.disabled_execution',
      },
      execution: {
        enabled: false,
        mode: 'auto',
      },
    });

    const descriptor = createMcpDescriptor(server);
    const result = await executeMcpToolCall(createMcpCall(server.id, descriptor), descriptor);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('mcp_execution_disabled');
    expect(result.detail).toContain('Disabled Execution MCP');
  });

  it('discovers tools through a Streamable HTTP initialized session', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });

      const responseHeaders = new Headers({ 'content-type': 'application/json' });
      if (body.method === 'initialize') responseHeaders.set('Mcp-Session-Id', 'discover-session-254');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/list'
          ? {
              tools: [{
                name: 'sample_tool',
                title: 'Sample Tool',
                description: 'Sample MCP tool.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    group: {
                      type: 'string',
                      enum: ['playwright', 'filesystem'],
                    },
                  },
                  required: ['group'],
                },
              }],
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = await createMcpServer({
      displayName: 'Discoverable HTTP MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48125/mcp',
      },
      timeouts: {
        connectMs: 1_000,
        requestMs: 1_000,
        discoveryMs: 1_000,
      },
    });

    const sparseState = structuredClone(storage[MCP_STORAGE_KEY]) as {
      servers: Array<{ id: string; secrets: unknown }>;
    };
    const sparseServer = sparseState.servers.find((item) => item.id === server.id);
    if (!sparseServer) throw new Error('Missing persisted MCP server.');
    sparseServer.secrets = [{ kind: 'bearer', value: '' }];
    storage[MCP_STORAGE_KEY] = sparseState;
    storageSet.mockClear();

    const cache = await refreshMcpServerDiscovery(server.id);

    expect(cache.health.status).toBe('ready');
    expect(cache.descriptors.map((descriptor) => descriptor.name)).toEqual(['sample_tool']);
    expect(cache.descriptors[0].inputSchema.properties?.group).toEqual({
      type: 'string',
      enum: ['playwright', 'filesystem'],
    });
    const persistedDescriptors = await getMcpToolDescriptors({ includeDisabled: true });
    expect(renderToolSchemas(persistedDescriptors)).toContain('"enum":["playwright","filesystem"]');
    expect(await getMcpToolCache(server.id)).toMatchObject({
      serverId: server.id,
      descriptors: [expect.objectContaining({ name: 'sample_tool' })],
      health: { status: 'ready', toolCount: 1 },
    });
    expect((storage[MCP_STORAGE_KEY] as { servers: Array<{ id: string; secrets: unknown }> }).servers
      .find((item) => item.id === server.id)?.secrets).toEqual([{ kind: 'bearer', value: '' }]);
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[0].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBe('discover-session-254');
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('discover-session-254');
    expect(requests[0].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('does not persist an error cache when stale discovery is cancelled', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
    })));
    const server = await createMcpServer({
      displayName: 'Cancelled Discovery MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48126/mcp',
      },
    });
    const before = await getMcpServerById(server.id);
    const controller = new AbortController();
    const reason = new Error('automation cancelled during discovery');
    const pending = refreshMcpServerDiscovery(server.id, { signal: controller.signal });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(await getMcpToolCache(server.id)).toBeNull();
    expect(await getMcpServerById(server.id)).toMatchObject({
      status: before?.status,
      lastError: before?.lastError,
      lastConnectedAt: before?.lastConnectedAt,
    });
  });

  it('rejects a discovery result when connection configuration changes during provider I/O', async () => {
    const oldUrl = 'http://127.0.0.1:48130/mcp';
    const newUrl = 'http://127.0.0.1:48131/mcp';
    const firstInitialize = deferred<Response>();
    let firstInitializeId: string | null = null;
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id?: string; method: string };
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      requests.push({ url, method: request.method });

      if (url === oldUrl && request.method === 'initialize') {
        firstInitializeId = request.id ?? null;
        return firstInitialize.promise;
      }
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });

      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: request.method === 'tools/list'
          ? {
              tools: [{
                name: url === newUrl ? 'new_tool' : 'old_tool',
                description: 'Configuration-bound discovery tool.',
                inputSchema: { type: 'object', properties: {} },
              }],
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const server = await createMcpServer({
      displayName: 'Mutable Discovery MCP',
      enabled: true,
      transport: { kind: 'streamable_http', url: oldUrl },
    });
    const pending = refreshMcpServerDiscovery(server.id);
    await vi.waitFor(() => expect(requests).toContainEqual({ url: oldUrl, method: 'initialize' }));

    await updateMcpServer(server.id, {
      transport: { kind: 'streamable_http', url: newUrl },
    });
    firstInitialize.resolve(new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: firstInitializeId,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(pending).rejects.toMatchObject({
      code: 'mcp_discovery_config_changed',
      retryable: true,
    });
    await expect(getMcpToolCache(server.id)).resolves.toBeNull();
    await expect(getMcpServerById(server.id)).resolves.toMatchObject({
      transport: { kind: 'streamable_http', url: newUrl },
      status: 'unknown',
      lastConnectedAt: null,
      lastError: null,
    });

    const refreshed = await refreshMcpServerDiscovery(server.id);
    expect(refreshed.descriptors.map((descriptor) => descriptor.name)).toEqual(['new_tool']);
    await expect(getMcpToolCache(server.id)).resolves.toMatchObject({
      descriptors: [expect.objectContaining({ name: 'new_tool' })],
      health: { status: 'ready' },
    });
  });

  it('keeps the last successful tool snapshot when a refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('provider offline');
    }));
    const server = await createMcpServer({
      displayName: 'Cached MCP',
      enabled: true,
      transport: { kind: 'http', url: 'http://127.0.0.1:48127/mcp' },
    });
    const descriptor = createMcpDescriptor(server, 'cached_tool');
    await saveMcpToolCache({
      serverId: server.id,
      descriptors: [descriptor],
      refreshedAt: 1_000,
      expiresAt: 2_000,
      health: {
        serverId: server.id,
        status: 'ready',
        checkedAt: 1_000,
        latencyMs: 10,
        toolCount: 1,
        error: null,
      },
    });
    storageSet.mockClear();

    const failed = await refreshMcpServerDiscovery(server.id);

    expect(failed).toMatchObject({
      descriptors: [expect.objectContaining({ name: 'cached_tool' })],
      refreshedAt: 1_000,
      expiresAt: 2_000,
      health: { status: 'error', toolCount: 1 },
    });
    await expect(getMcpToolCache(server.id)).resolves.toEqual(failed);
    await expect(getMcpToolDescriptors({ includeDisabled: true })).resolves.toEqual([
      expect.objectContaining({ name: 'cached_tool' }),
    ]);
    await expect(getMcpServerById(server.id)).resolves.toMatchObject({
      status: 'error',
      lastError: expect.stringContaining('Cannot reach MCP server'),
    });
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('does not recast discovery persistence failures as provider failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: string; method: string };
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/list'
          ? {
              tools: [{
                name: 'persisted_tool',
                description: 'Must not be reported as a provider failure.',
                inputSchema: { type: 'object', properties: {} },
              }],
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const server = await createMcpServer({
      displayName: 'Persistence Failure MCP',
      enabled: true,
      transport: { kind: 'http', url: 'http://127.0.0.1:48129/mcp' },
    });
    const before = await getMcpServerById(server.id);
    const persistenceError = new Error('MCP storage write failed');
    storageSet.mockClear();
    storageSet.mockRejectedValueOnce(persistenceError);

    await expect(refreshMcpServerDiscovery(server.id)).rejects.toBe(persistenceError);
    await expect(getMcpToolCache(server.id)).resolves.toBeNull();
    await expect(getMcpServerById(server.id)).resolves.toMatchObject({
      status: before?.status,
      lastConnectedAt: before?.lastConnectedAt,
      lastError: before?.lastError,
    });
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('serializes discovery per server without poisoning the queue after failure', async () => {
    const firstInitialize = deferred<Response>();
    let initializeCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id?: string; method: string };
      if (request.method === 'initialize') {
        initializeCount += 1;
        if (initializeCount === 1) return firstInitialize.promise;
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (request.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: {
          tools: [{
            name: 'queued_tool',
            description: 'Discovered after the failed refresh.',
            inputSchema: { type: 'object', properties: {} },
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const server = await createMcpServer({
      displayName: 'Queued MCP',
      enabled: true,
      transport: { kind: 'http', url: 'http://127.0.0.1:48128/mcp' },
    });

    const first = refreshMcpServerDiscovery(server.id);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = refreshMcpServerDiscovery(server.id);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();

    firstInitialize.reject(new TypeError('first refresh failed'));

    await expect(first).resolves.toMatchObject({ health: { status: 'error' } });
    await expect(second).resolves.toMatchObject({
      descriptors: [expect.objectContaining({ name: 'queued_tool' })],
      health: { status: 'ready', toolCount: 1 },
    });
    await expect(getMcpToolCache(server.id)).resolves.toMatchObject({
      descriptors: [expect.objectContaining({ name: 'queued_tool' })],
      health: { status: 'ready' },
    });
  });

  it('initializes Streamable HTTP sessions before executing cached tools', async () => {
    const requests: Array<{ method: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ method: body.method, headers });

      const responseHeaders = new Headers({ 'content-type': 'application/json' });
      if (body.method === 'initialize') responseHeaders.set('Mcp-Session-Id', 'exec-session-254');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: body.method === 'tools/call'
          ? {
              content: [{ type: 'text', text: 'done' }],
              structuredContent: { ok: true },
              isError: false,
            }
          : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
      }), { status: 200, headers: responseHeaders });
    }));

    const server = await createMcpServer({
      displayName: 'Stateful HTTP MCP',
      enabled: true,
      transport: {
        kind: 'streamable_http',
        url: 'http://127.0.0.1:48124/mcp',
      },
      timeouts: {
        connectMs: 1_000,
        requestMs: 1_000,
        discoveryMs: 1_000,
      },
    });
    const descriptor = createMcpDescriptor(server);
    await saveMcpToolCache({
      serverId: server.id,
      descriptors: [descriptor],
      refreshedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      health: {
        serverId: server.id,
        status: 'ready',
        checkedAt: Date.now(),
        latencyMs: 1,
        toolCount: 1,
        error: null,
      },
    });

    const result = await executeMcpToolCall(createMcpCall(server.id, descriptor), descriptor);

    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(requests[0].headers.get('Mcp-Session-Id')).toBeNull();
    expect(requests[1].headers.get('Mcp-Session-Id')).toBe('exec-session-254');
    expect(requests[2].headers.get('Mcp-Session-Id')).toBe('exec-session-254');
    expect(requests[0].headers.get('MCP-Protocol-Version')).toBeNull();
    expect(requests[1].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
    expect(requests[2].headers.get('MCP-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
  });

  it('exposes only policy-enabled auto MCP tools to the prompt runtime', async () => {
    const server = await createMcpServer({
      displayName: 'Policy MCP',
      enabled: true,
      transport: {
        kind: 'native_messaging',
        nativeHost: 'com.example.policy',
      },
      allowlist: {
        mode: 'allow',
        toolNames: ['local_file_read'],
      },
      execution: {
        enabled: true,
        mode: 'auto',
      },
    });
    const descriptors = [
      createMcpDescriptor(server, 'local_file_read'),
      createMcpDescriptor(server, 'shell_exec'),
    ];
    await saveMcpToolCache({
      serverId: server.id,
      descriptors,
      refreshedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      health: {
        serverId: server.id,
        status: 'ready',
        checkedAt: Date.now(),
        latencyMs: 1,
        toolCount: descriptors.length,
        error: null,
      },
    });

    await expect(getMcpToolDescriptors()).resolves.toEqual([
      expect.objectContaining({ name: 'local_file_read' }),
    ]);

    await updateMcpServer(server.id, {
      allowlist: { mode: 'deny', toolNames: ['local_file_read'] },
    });
    await expect(getMcpToolDescriptors()).resolves.toEqual([
      expect.objectContaining({ name: 'shell_exec' }),
    ]);

    await updateMcpServer(server.id, {
      execution: { enabled: true, mode: 'disabled' },
    });
    await expect(getMcpToolDescriptors()).resolves.toEqual([]);
  });
});

function createMcpCall(serverId: string, descriptor?: ToolDescriptor): ToolCall {
  return {
    name: descriptor?.name ?? 'sample_tool',
    invocationName: descriptor?.invocationName ?? createMcpInvocationName(serverId, 'sample_tool'),
    descriptorId: descriptor?.id ?? createMcpDescriptorId(serverId, 'sample_tool'),
    provider: {
      kind: 'mcp',
      id: serverId,
      displayName: descriptor?.provider.displayName ?? 'Disabled Execution MCP',
      transport: descriptor?.provider.transport ?? 'native_messaging',
    },
    payload: {},
    raw: '',
  };
}

function createMcpDescriptor(server: McpServerConfig, name = 'sample_tool'): ToolDescriptor {
  return {
    id: createMcpDescriptorId(server.id, name),
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    name,
    invocationName: createMcpInvocationName(server.id, name),
    title: name,
    description: `${name} MCP tool.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
      timeoutMs: 1_000,
      maxResultBytes: 64_000,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

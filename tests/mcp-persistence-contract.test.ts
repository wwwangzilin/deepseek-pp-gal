import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolProviderRegistry } from '../core/tool/provider-registry';
import { getMcpToolDescriptors, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import {
  createMcpServer,
  getAllMcpServers,
  getMcpServerById,
  getMcpToolCache,
  updateMcpServer,
  updateMcpServerHealth,
} from '../core/mcp/store';
import {
  decodeMcpStorageState,
  encodeMcpStorageState,
  MCP_STORAGE_KEY,
  McpStorageContractError,
  migrateMcpStorageState,
} from '../core/mcp/storage-codec';
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  MCP_REQUEST_TIMEOUT_STORAGE_KEY,
} from '../core/mcp/config';
import {
  MCP_CACHE_ENTRY,
  MCP_SERVER_IDS,
  MCP_STORAGE_CORRUPT_SERVER,
  MCP_STORAGE_DUPLICATE_SERVER,
  MCP_STORAGE_FUTURE_ROOT,
  MCP_STORAGE_FUTURE_SERVER,
  MCP_STORAGE_FUTURE_TRANSPORT,
  MCP_STORAGE_ORPHAN_CACHE,
  MCP_STORAGE_V1_ADDITIVE_ROOT,
  MCP_STORAGE_V1_CORRUPT_SERVER,
  MCP_STORAGE_V1_STALE_CACHE,
  MCP_STORAGE_V2,
  MCP_STORAGE_V2_ADDITIVE_ROOT,
  MCP_STORAGE_V2_COLLIDING_CACHE,
  MCP_STORAGE_V2_FORGED_CACHE_ANNOTATION,
  MCP_STORAGE_V2_FORGED_CACHE_TRANSPORT,
} from './fixtures/persistence-contract/mcp';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
let storageRemove: ReturnType<typeof vi.fn>;
let randomUUID: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let connectNative: ReturnType<typeof vi.fn>;
let permissionContains: ReturnType<typeof vi.fn>;
let permissionRequest: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    storage = { ...storage, ...values };
  });
  storageRemove = vi.fn();
  randomUUID = vi.fn(() => 'new-contract-id');
  fetchMock = vi.fn();
  connectNative = vi.fn();
  permissionContains = vi.fn();
  permissionRequest = vi.fn();
  vi.stubGlobal('crypto', { randomUUID });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => Object.prototype.hasOwnProperty.call(storage, key)
          ? { [key]: storage[key] }
          : {}),
        set: storageSet,
        remove: storageRemove,
      },
    },
    permissions: {
      contains: permissionContains,
      request: permissionRequest,
    },
    runtime: { connectNative },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP persisted-config contract', () => {
  it('decodes and encodes every current v2 transport without changing the record', () => {
    const raw = structuredClone(MCP_STORAGE_V2);

    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
    expect(raw).toEqual(MCP_STORAGE_V2);
  });

  it('falls back to the globally configured request timeout when a server omits requestMs', async () => {
    storage[MCP_REQUEST_TIMEOUT_STORAGE_KEY] = 300_000;
    const server = await createMcpServer({
      displayName: 'Global timeout server',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.global_timeout' },
    });
    expect(server.timeouts.requestMs).toBe(300_000);
  });

  it('keeps the generic default request timeout when the server sets one explicitly', async () => {
    const server = await createMcpServer({
      displayName: 'Explicit timeout server',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.explicit_timeout' },
      timeouts: { connectMs: 5_000, requestMs: 90_000, discoveryMs: 10_000 },
    });
    expect(server.timeouts.requestMs).toBe(90_000);
  });

  it('uses the default request timeout when no global timeout is stored', async () => {
    delete storage[MCP_REQUEST_TIMEOUT_STORAGE_KEY];
    const server = await createMcpServer({
      displayName: 'Default timeout server',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.default_timeout' },
    });
    expect(server.timeouts.requestMs).toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
  });

  it('normalizes a released manual execution mode to auto at decode without rewriting storage', () => {
    const raw = structuredClone(MCP_STORAGE_V2);
    raw.servers = raw.servers.map((server, index) => (
      index === 0
        ? { ...server, execution: { ...server.execution, mode: 'manual' } }
        : server
    )) as typeof raw.servers;

    const decoded = decodeMcpStorageState(raw);
    const decodedFirst = decoded.servers[0];
    expect(decodedFirst?.execution.mode).toBe('auto');
    // The stored record keeps the released value; the normalization is
    // deterministic and idempotent and only materializes on the next save.
    expect((raw.servers[0] as { execution: { mode: string } }).execution.mode).toBe('manual');
    expect(decodeMcpStorageState(raw).servers[0]?.execution.mode).toBe('auto');
  });

  it('migrates legal v1 server configuration, preserves additive root fields, and clears its cache', () => {
    const raw = structuredClone(MCP_STORAGE_V1_ADDITIVE_ROOT);
    const original = structuredClone(raw);

    expect(migrateMcpStorageState(raw)).toEqual({
      migrated: true,
      state: {
        ...MCP_STORAGE_V2,
        additiveField: { preserve: true },
        toolCaches: [],
      },
    });
    expect(raw).toEqual(original);
  });

  it('migrates a stale v1 cache before serving its server configuration exactly once', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V1_STALE_CACHE);

    await expect(getAllMcpServers({ includeSecrets: true })).resolves.toEqual(MCP_STORAGE_V2.servers);
    expect(storage[MCP_STORAGE_KEY]).toEqual({
      ...MCP_STORAGE_V2,
      toolCaches: [],
    });
    expect(storageSet).toHaveBeenCalledTimes(1);

    await expect(getAllMcpServers()).resolves.toHaveLength(MCP_STORAGE_V2.servers.length);
    expect(storageSet).toHaveBeenCalledTimes(1);
  });

  it('keeps a sparse persisted connection cache after discovery health updates', async () => {
    const sparseState = structuredClone(MCP_STORAGE_V2);
    const shellServer = sparseState.servers.find((server) => server.id === MCP_SERVER_IDS.shell);
    if (!shellServer) throw new Error('Missing Shell MCP fixture.');
    delete shellServer.secrets[0].id;
    storage[MCP_STORAGE_KEY] = sparseState;

    await updateMcpServerHealth(MCP_SERVER_IDS.shell, {
      status: 'ready',
      lastConnectedAt: MCP_STORAGE_V2.toolCaches[0].health.checkedAt + 1,
      lastError: null,
    });

    const state = decodeMcpStorageState(storage[MCP_STORAGE_KEY]);
    expect(state.toolCaches).toEqual([MCP_CACHE_ENTRY]);
    expect(state.servers.find((server) => server.id === MCP_SERVER_IDS.shell)).toMatchObject({
      id: MCP_SERVER_IDS.shell,
      status: 'ready',
    });
  });

  it('keeps valid sparse configuration untouched while recording health', async () => {
    const sparseState = structuredClone(MCP_STORAGE_V2);
    const shellServer = sparseState.servers.find((server) => server.id === MCP_SERVER_IDS.shell);
    if (!shellServer) throw new Error('Missing Shell MCP fixture.');
    shellServer.secrets = [{ kind: 'bearer', value: '' }];
    storage[MCP_STORAGE_KEY] = sparseState;

    await updateMcpServerHealth(MCP_SERVER_IDS.shell, {
      status: 'error',
      lastError: 'connection refused',
    });

    const state = decodeMcpStorageState(storage[MCP_STORAGE_KEY]);
    expect(state.toolCaches).toEqual([MCP_CACHE_ENTRY]);
    expect(state.servers.find((server) => server.id === MCP_SERVER_IDS.shell)).toMatchObject({
      id: MCP_SERVER_IDS.shell,
      secrets: [{ kind: 'bearer', value: '' }],
      status: 'error',
      lastError: 'connection refused',
    });
  });

  it('keeps a disabled server disabled when discovery records connection health', async () => {
    const disabledState = structuredClone(MCP_STORAGE_V2);
    const shellServer = disabledState.servers.find((server) => server.id === MCP_SERVER_IDS.shell);
    if (!shellServer) throw new Error('Missing Shell MCP fixture.');
    shellServer.enabled = false;
    shellServer.status = 'disabled';
    storage[MCP_STORAGE_KEY] = disabledState;

    await updateMcpServerHealth(MCP_SERVER_IDS.shell, {
      status: 'ready',
      lastConnectedAt: MCP_STORAGE_V2.toolCaches[0].health.checkedAt + 1,
      lastError: null,
    });

    expect((await getMcpServerById(MCP_SERVER_IDS.shell))?.status).toBe('disabled');
  });

  it('preserves the discovery cache when a tool allowlist changes', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V2);

    await updateMcpServer(MCP_SERVER_IDS.shell, {
      allowlist: {
        mode: 'deny',
        toolNames: ['python_exec'],
      },
    });

    expect(await getMcpToolCache(MCP_SERVER_IDS.shell)).toEqual(MCP_CACHE_ENTRY);
  });

  it('preserves the discovery cache when only the execution policy changes', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V2);

    await updateMcpServer(MCP_SERVER_IDS.shell, {
      execution: { enabled: true, mode: 'disabled' },
    });

    expect(await getMcpToolCache(MCP_SERVER_IDS.shell)).toEqual(MCP_CACHE_ENTRY);
    expect(await getMcpServerById(MCP_SERVER_IDS.shell)).toMatchObject({
      execution: { enabled: true, mode: 'disabled' },
    });
  });

  it('keeps the discovered list after a disabled-mode allowlist selection change', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V2);

    await updateMcpServer(MCP_SERVER_IDS.shell, {
      execution: { enabled: true, mode: 'disabled' },
      allowlist: { mode: 'deny', toolNames: ['shell_status'] },
    });

    expect(await getMcpToolCache(MCP_SERVER_IDS.shell)).toEqual(MCP_CACHE_ENTRY);
    expect(await getMcpServerById(MCP_SERVER_IDS.shell)).toMatchObject({
      allowlist: { mode: 'deny', toolNames: ['shell_status'] },
    });
  });

  it('accepts current v2 cache collisions so the user can clear or refresh them', () => {
    const raw = structuredClone(MCP_STORAGE_V2_COLLIDING_CACHE);

    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
  });

  it('rejects a current cache collision when it becomes an active catalog', async () => {
    const state = decodeMcpStorageState(structuredClone(MCP_STORAGE_V2_COLLIDING_CACHE));
    const registry = new ToolProviderRegistry([{
      registration: { kind: 'mcp' },
      async listTools() {
        return state.toolCaches[0].descriptors;
      },
      execute: vi.fn(),
    }]);

    await expect(registry.listTools({ locale: 'en', includeDisabled: true })).rejects.toMatchObject({
      code: 'tool_invocation_duplicate',
    });
  });

  it('preserves additive top-level fields through codec and store mutations', async () => {
    const raw = structuredClone(MCP_STORAGE_V2_ADDITIVE_ROOT);
    expect(encodeMcpStorageState(decodeMcpStorageState(raw))).toEqual(raw);
    storage[MCP_STORAGE_KEY] = raw;

    await updateMcpServer(MCP_SERVER_IDS.shell, { displayName: 'Additive field preserved' });

    expect(storage[MCP_STORAGE_KEY]).toMatchObject({
      additiveField: { preserve: true },
    });
  });

  it('treats a missing key as empty v2 without writing storage', async () => {
    await expect(getAllMcpServers()).resolves.toEqual([]);
    expect(storageSet).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it.each([
    ['future root', MCP_STORAGE_FUTURE_ROOT, 'mcp_storage_version_unsupported'],
    ['future server', MCP_STORAGE_FUTURE_SERVER, 'mcp_storage_version_unsupported'],
    ['future transport', MCP_STORAGE_FUTURE_TRANSPORT, 'mcp_storage_transport_unsupported'],
    ['corrupt server', MCP_STORAGE_CORRUPT_SERVER, 'mcp_storage_corrupt'],
    ['corrupt legacy server', MCP_STORAGE_V1_CORRUPT_SERVER, 'mcp_storage_corrupt'],
    ['duplicate server', MCP_STORAGE_DUPLICATE_SERVER, 'mcp_storage_corrupt'],
    ['orphan cache', MCP_STORAGE_ORPHAN_CACHE, 'mcp_storage_corrupt'],
    ['forged cache annotation', MCP_STORAGE_V2_FORGED_CACHE_ANNOTATION, 'mcp_storage_corrupt'],
    ['forged cache transport', MCP_STORAGE_V2_FORGED_CACHE_TRANSPORT, 'mcp_storage_corrupt'],
  ])('rejects %s before mutation and preserves the raw record', async (_name, fixture, code) => {
    const raw = structuredClone(fixture);
    const originalJson = JSON.stringify(raw);
    storage[MCP_STORAGE_KEY] = raw;

    const first = createMcpServer({
      displayName: 'Must not be created',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.must_not_run' },
    });
    await expect(first).rejects.toEqual(expect.objectContaining({
      name: 'McpStorageContractError',
      code,
    }));
    await expect(getAllMcpServers()).rejects.toBeInstanceOf(McpStorageContractError);

    expect(JSON.stringify(storage[MCP_STORAGE_KEY])).toBe(originalJson);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectNative).not.toHaveBeenCalled();
    expect(permissionContains).not.toHaveBeenCalled();
    expect(permissionRequest).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted state before discovery or descriptor reads can perform provider I/O', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_FUTURE_TRANSPORT);

    await expect(getMcpToolDescriptors()).rejects.toMatchObject({
      code: 'mcp_storage_transport_unsupported',
    });
    await expect(refreshMcpServerDiscovery(MCP_SERVER_IDS.http)).rejects.toMatchObject({
      code: 'mcp_storage_transport_unsupported',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectNative).not.toHaveBeenCalled();
    expect(permissionContains).not.toHaveBeenCalled();
    expect(permissionRequest).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('serializes concurrent whole-key mutations so neither server update is lost', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V2);

    await Promise.all([
      updateMcpServer(MCP_SERVER_IDS.http, { displayName: 'Updated HTTP' }),
      updateMcpServer(MCP_SERVER_IDS.shell, { displayName: 'Updated Shell' }),
    ]);

    const state = decodeMcpStorageState(storage[MCP_STORAGE_KEY]);
    expect(state.servers.find((server) => server.id === MCP_SERVER_IDS.http)?.displayName)
      .toBe('Updated HTTP');
    expect(state.servers.find((server) => server.id === MCP_SERVER_IDS.shell)?.displayName)
      .toBe('Updated Shell');
  });

  it('preserves server and secret identities through redacted updates', async () => {
    storage[MCP_STORAGE_KEY] = structuredClone(MCP_STORAGE_V2);
    const before = await getMcpServerById(MCP_SERVER_IDS.shell, { includeSecrets: true });
    const redacted = await getMcpServerById(MCP_SERVER_IDS.shell);

    expect(redacted?.secrets).toEqual([
      expect.objectContaining({ id: 'secret-contract-shell', value: '********' }),
    ]);
    await updateMcpServer(MCP_SERVER_IDS.shell, {
      displayName: 'Renamed Shell',
      secrets: redacted?.secrets,
    });
    const after = await getMcpServerById(MCP_SERVER_IDS.shell, { includeSecrets: true });

    expect(after).toMatchObject({
      id: before?.id,
      displayName: 'Renamed Shell',
      secrets: [{ id: 'secret-contract-shell', value: 'contract-secret-value' }],
    });
    expect(randomUUID).not.toHaveBeenCalled();
    expect(decodeMcpStorageState(storage[MCP_STORAGE_KEY])).toEqual(storage[MCP_STORAGE_KEY]);
  });
});

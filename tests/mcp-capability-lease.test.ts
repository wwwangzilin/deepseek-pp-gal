import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_CAPABILITY_LEASE_STORAGE_KEY,
  MCP_CAPABILITY_LEASE_TTL_MS,
  McpCapabilityLeaseError,
  createToolCapabilityScope,
  issueMcpCapabilityLeases,
  resolveMcpCapabilityLease,
} from '../core/mcp/capability-lease';
import type { ToolDescriptor } from '../core/types';

let sessionStorage: Record<string, unknown>;
let sessionSet: ReturnType<typeof vi.fn>;
let uuid = 0;

beforeEach(() => {
  sessionStorage = {};
  uuid = 0;
  sessionSet = vi.fn(async (values: Record<string, unknown>) => {
    sessionStorage = { ...sessionStorage, ...values };
  });
  const nativeCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', {
    subtle: nativeCrypto.subtle,
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`),
  });
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => (
          Object.hasOwn(sessionStorage, key) ? { [key]: sessionStorage[key] } : {}
        )),
        set: sessionSet,
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP capability leases', () => {
  it('binds a discovered capability to one trusted scope and consumes it exactly once', async () => {
    const descriptor = createDescriptor();
    const owner = createOwner('turn-a');
    const [issued] = await issueMcpCapabilityLeases({
      owner,
      descriptors: [descriptor],
      now: 1_000,
    });

    await expect(resolveMcpCapabilityLease({
      handle: issued.handle,
      owner,
      currentDescriptors: [descriptor],
      consume: true,
      now: 1_001,
    })).resolves.toEqual(descriptor);

    await expect(resolveMcpCapabilityLease({
      handle: issued.handle,
      owner,
      currentDescriptors: [descriptor],
      consume: true,
      now: 1_002,
    })).rejects.toMatchObject({
      name: 'McpCapabilityLeaseError',
      code: 'mcp_capability_handle_replayed',
    } satisfies Partial<McpCapabilityLeaseError>);
  });

  it('rejects a handle from another scope and invalidates it if the descriptor security snapshot changes', async () => {
    const descriptor = createDescriptor();
    const owner = createOwner('turn-a');
    const [issued] = await issueMcpCapabilityLeases({ owner, descriptors: [descriptor], now: 1_000 });

    await expect(resolveMcpCapabilityLease({
      handle: issued.handle,
      owner: createOwner('turn-b'),
      currentDescriptors: [descriptor],
      consume: false,
      now: 1_001,
    })).rejects.toMatchObject({ code: 'mcp_capability_handle_owner_mismatch' });

    const [staleIssued] = await issueMcpCapabilityLeases({ owner, descriptors: [descriptor], now: 1_002 });
    await expect(resolveMcpCapabilityLease({
      handle: staleIssued.handle,
      owner,
      currentDescriptors: [createDescriptor({
        inputSchema: {
          type: 'object',
          properties: { destructive: { type: 'boolean' } },
          additionalProperties: false,
        },
      })],
      consume: true,
      now: 1_003,
    })).rejects.toMatchObject({ code: 'mcp_capability_descriptor_stale' });
  });

  it('allows an inline agent grant to continue the originating manual-chat capability scope', async () => {
    const descriptor = createDescriptor();
    const manualOwner = createGrantOwner('manual_chat');
    const [issued] = await issueMcpCapabilityLeases({
      owner: manualOwner,
      descriptors: [descriptor],
      now: 1_000,
    });

    await expect(resolveMcpCapabilityLease({
      handle: issued.handle,
      owner: createGrantOwner('agent_run'),
      currentDescriptors: [descriptor],
      consume: false,
      now: 1_001,
    })).resolves.toEqual(descriptor);
  });

  it('distinguishes expiration from unknown handles and fails closed on corrupt lease state', async () => {
    const descriptor = createDescriptor();
    const owner = createOwner('turn-a');
    const [issued] = await issueMcpCapabilityLeases({ owner, descriptors: [descriptor], now: 1_000 });

    await expect(resolveMcpCapabilityLease({
      handle: issued.handle,
      owner,
      currentDescriptors: [descriptor],
      consume: false,
      now: 1_000 + MCP_CAPABILITY_LEASE_TTL_MS,
    })).rejects.toMatchObject({ code: 'mcp_capability_handle_expired' });

    sessionStorage[MCP_CAPABILITY_LEASE_STORAGE_KEY] = { version: 1, leases: 'corrupt' };
    const original = structuredClone(sessionStorage[MCP_CAPABILITY_LEASE_STORAGE_KEY]);
    await expect(issueMcpCapabilityLeases({ owner, descriptors: [descriptor], now: 2_000 }))
      .rejects.toMatchObject({ code: 'mcp_capability_lease_state_invalid' });
    expect(sessionStorage[MCP_CAPABILITY_LEASE_STORAGE_KEY]).toEqual(original);
  });
});

function createOwner(scopeId: string) {
  return createToolCapabilityScope({
    kind: 'trusted',
    scopeId,
    trigger: 'sidepanel_chat',
    chatSessionId: 'chat-1',
  });
}

function createGrantOwner(trigger: 'manual_chat' | 'agent_run') {
  return createToolCapabilityScope({
    kind: 'grant',
    scopeId: 'request-1',
    trigger,
    chatSessionId: 'chat-1',
    subject: {
      surface: 'deepseek_content',
      documentSessionId: 'document-1',
      tabId: 7,
      frameId: 0,
      chatSessionId: 'chat-1',
    },
  });
}

function createDescriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    id: 'mcp:server-1:write_document',
    provider: {
      kind: 'mcp',
      id: 'server-1',
      displayName: 'MCP Server',
      transport: 'streamable_http',
    },
    name: 'write_document',
    invocationName: 'write_document',
    title: 'Write document',
    description: 'Writes a document.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'medium' },
    ...overrides,
  };
}

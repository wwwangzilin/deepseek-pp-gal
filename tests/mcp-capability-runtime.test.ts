import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpCapabilityInvocationResolver } from '../core/mcp/capability-runtime';
import {
  MCP_CAPABILITY_TOOL_PROVIDER_ID,
  createMcpCapabilityToolDescriptors,
  executeMcpCapabilityToolCall,
} from '../core/mcp/capability-tools';
import { getToolCallHistory } from '../core/tool/history';
import {
  ToolProviderRegistry,
  type RuntimeToolProvider,
} from '../core/tool/provider-registry';
import { createRuntimeToolRuntime } from '../core/tool/runtime';
import type { ToolCall, ToolDescriptor, ToolResult } from '../core/types';

let localStorage: Record<string, unknown>;
let sessionStorage: Record<string, unknown>;
let uuid = 0;

beforeEach(() => {
  localStorage = {};
  sessionStorage = {};
  uuid = 0;
  const nativeCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', {
    subtle: nativeCrypto.subtle,
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`),
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: createStorageArea(() => localStorage, (value) => { localStorage = value; }),
      session: createStorageArea(() => sessionStorage, (value) => { sessionStorage = value; }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP capability invoke runtime', () => {
  it('allows only opaque discovered handles and records the resolved target, not the proxy', async () => {
    const target = createTargetDescriptor();
    target.description = 'x'.repeat(481);
    const controls = createMcpCapabilityToolDescriptors('en');
    const targetExecute = vi.fn(async (call: ToolCall, descriptor: ToolDescriptor): Promise<ToolResult> => ({
      ok: true,
      summary: 'target completed',
      name: descriptor.name,
      descriptorId: descriptor.id,
      provider: descriptor.provider,
      output: { observedPath: typeof call.payload.path === 'string' ? call.payload.path : '' },
    }));
    const registry = new ToolProviderRegistry([
      createCapabilityProvider(controls),
      {
        registration: { kind: 'mcp' },
        listTools: vi.fn(async () => [target]),
        execute: targetExecute,
      },
    ]);
    const runtime = createRuntimeToolRuntime(registry, {
      capabilityInvocationResolver: createMcpCapabilityInvocationResolver(),
    });
    const discover = findControl(controls, 'mcp_discover');
    const invoke = findControl(controls, 'mcp_invoke');

    const tooLongDiscover = await runtime.executeToolCall(
      createCall(discover, { query: 'x'.repeat(2_001) }, 'call-discover-too-long'),
      'sidepanel_chat',
      'en',
      { trustedCapabilityScopeId: 'chat-turn-1' },
    );
    expect(tooLongDiscover).toMatchObject({
      ok: false,
      error: { code: 'mcp_capability_discover_query_invalid' },
    });

    const rejected = await runtime.executeToolCall(
      createCall(invoke, { name: target.name, args: { path: '/unsafe' } }, 'call-raw-name'),
      'sidepanel_chat',
      'en',
      { trustedCapabilityScopeId: 'chat-turn-1' },
    );
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'mcp_capability_invoke_payload_invalid' },
    });
    expect(targetExecute).not.toHaveBeenCalled();

    const discovered = await runtime.executeToolCall(
      createCall(discover, { query: 'write a document' }, 'call-discover'),
      'sidepanel_chat',
      'en',
      { trustedCapabilityScopeId: 'chat-turn-1' },
    );
    expect(discovered.ok).toBe(true);
    const output = discovered.output as unknown as {
      candidates: Array<{
        capability: string;
        name: string;
        description: string;
        descriptionTruncated?: boolean;
      }>;
    };
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]?.name).toBe(target.name);
    expect(output.candidates[0]?.description).toHaveLength(481);
    expect(output.candidates[0]?.descriptionTruncated).toBe(true);

    const invoked = await runtime.executeToolCall(
      createCall(invoke, {
        capability: output.candidates[0]!.capability,
        arguments: { path: '/workspace/plan.md' },
      }, 'call-invoke'),
      'sidepanel_chat',
      'en',
      { trustedCapabilityScopeId: 'chat-turn-1' },
    );
    expect(invoked).toMatchObject({
      ok: true,
      name: target.name,
      descriptorId: target.id,
      provider: target.provider,
    });
    expect(targetExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: target.name,
        invocationName: target.invocationName,
        descriptorId: target.id,
        provider: target.provider,
        payload: { path: '/workspace/plan.md' },
      }),
      target,
      expect.any(Object),
    );

    const history = await getToolCallHistory(20);
    expect(history.find((record) => record.call.id === 'call-invoke')).toMatchObject({
      call: {
        name: target.name,
        invocationName: target.invocationName,
        descriptorId: target.id,
        provider: target.provider,
      },
      result: { name: target.name, descriptorId: target.id, provider: target.provider },
    });

    const replay = await runtime.executeToolCall(
      createCall(invoke, {
        capability: output.candidates[0]!.capability,
        arguments: { path: '/workspace/replay.md' },
      }, 'call-replay'),
      'sidepanel_chat',
      'en',
      { trustedCapabilityScopeId: 'chat-turn-1' },
    );
    expect(replay).toMatchObject({
      ok: false,
      error: { code: 'mcp_capability_handle_replayed' },
    });
    expect(targetExecute).toHaveBeenCalledTimes(1);
  });
});

function createCapabilityProvider(controls: readonly ToolDescriptor[]): RuntimeToolProvider {
  return {
    registration: { kind: 'local', id: MCP_CAPABILITY_TOOL_PROVIDER_ID },
    listTools: vi.fn(async () => [...controls]),
    execute: executeMcpCapabilityToolCall,
  };
}

function findControl(descriptors: readonly ToolDescriptor[], invocationName: string): ToolDescriptor {
  const descriptor = descriptors.find((candidate) => candidate.invocationName === invocationName);
  if (!descriptor) throw new Error(`Missing capability control ${invocationName}.`);
  return descriptor;
}

function createCall(
  descriptor: ToolDescriptor,
  payload: Record<string, unknown>,
  id: string,
): ToolCall {
  return {
    id,
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload,
    raw: `<${descriptor.invocationName}>${JSON.stringify(payload)}</${descriptor.invocationName}>`,
    source: {
      trigger: 'sidepanel_chat',
      requestId: 'sidepanel-request-1',
      chatSessionId: 'chat-1',
    },
  };
}

function createTargetDescriptor(): ToolDescriptor {
  return {
    id: 'mcp:server-1:write_document',
    provider: {
      kind: 'mcp',
      id: 'server-1',
      displayName: 'Workspace MCP',
      transport: 'streamable_http',
    },
    name: 'write_document',
    invocationName: 'write_document',
    title: 'Write document',
    description: 'Write a document to the workspace.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'medium' },
  };
}

function createStorageArea(
  read: () => Record<string, unknown>,
  write: (value: Record<string, unknown>) => void,
) {
  return {
    get: vi.fn(async (key: string) => (
      Object.hasOwn(read(), key) ? { [key]: read()[key] } : {}
    )),
    set: vi.fn(async (values: Record<string, unknown>) => {
      write({ ...read(), ...values });
    }),
  };
}

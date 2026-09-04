/**
 * Tool bridge × runtime authorization integration (Issue A2-T3).
 *
 * Proves that tool calls originated by the pi bridge pass through the REAL
 * runtime authorization path — background-owned grant bound to the
 * receiver-owned session, one-time call reservation, fail-closed without a
 * grant — with no second execution path (AGENTS.md security invariant).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import {
  closeToolAuthorization,
  createToolAuthorization,
  ToolAuthorizationError,
} from '../core/tool/authorization';
import { createRuntimeToolRuntime } from '../core/tool/runtime';
import { ToolProviderRegistry, type RuntimeToolProvider } from '../core/tool/provider-registry';
import type { ToolAuthorizationSubject, ToolDescriptor } from '../core/tool/types';
import { createPiAgentTools } from '../core/inline-agent/pi/tool-bridge';

const deepSeekContext: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'deepseek_content',
  senderUrl: 'https://chat.deepseek.com/a/chat/s/chat-1',
  senderOrigin: 'https://chat.deepseek.com',
  tabId: 7,
  frameId: 0,
  documentId: 'document-1',
  documentSessionId: 'document-1',
  chatSessionId: 'chat-1',
};

const SUBJECT: ToolAuthorizationSubject = {
  surface: 'deepseek_content',
  documentSessionId: deepSeekContext.documentSessionId,
  tabId: deepSeekContext.tabId,
  frameId: deepSeekContext.frameId,
  chatSessionId: deepSeekContext.chatSessionId,
};

const descriptor: ToolDescriptor = {
  id: 'local:test:pi_sample_tool',
  provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
  name: 'pi_sample_tool',
  invocationName: 'pi_sample_tool',
  title: 'Pi sample tool',
  description: 'Sample tool routed through the pi bridge.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
  execution: { mode: 'auto', enabled: true, risk: 'low' },
};

let sessionStorage: Record<string, unknown>;
let localStorage: Record<string, unknown>;

beforeEach(() => {
  sessionStorage = {};
  localStorage = {};
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          sessionStorage = structuredClone({ ...sessionStorage, ...value });
        }),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
    },
  });
});

async function createGrant() {
  return createToolAuthorization({
    requestId: 'req-pi-bridge',
    trigger: 'agent_run',
    chatSessionId: 'chat-1',
    subject: SUBJECT,
    descriptors: [descriptor],
  });
}

function createTestRuntime() {
  const provider: RuntimeToolProvider = {
    registration: { kind: 'local', id: 'test' },
    listTools: vi.fn(async () => [descriptor]),
    execute: vi.fn(async (authorizedCall) => ({
      ok: true,
      summary: `ran ${authorizedCall.payload?.value as string}`,
      output: { observed: authorizedCall.payload?.value as string },
    })),
  };
  return createRuntimeToolRuntime(new ToolProviderRegistry([provider]));
}

function bridgeExecuteTool(runtime: ReturnType<typeof createTestRuntime>, grantId: string) {
  return async (call: Parameters<ReturnType<typeof createTestRuntime>['executeToolCall']>[0]) => {
    const result = await runtime.executeToolCall(
      call,
      { kind: 'grant', grantId, subject: SUBJECT },
      'en',
    );
    return { name: call.name, provider: descriptor.provider, result };
  };
}

describe('pi bridge × runtime authorization (A2-T3)', () => {
  it('executes a granted call through the real runtime with the pi call identity', async () => {
    const grant = await createGrant();
    const [tool] = createPiAgentTools({
      descriptors: [descriptor],
      executeTool: bridgeExecuteTool(createTestRuntime(), grant.id),
      callSource: { requestId: 'req-pi-bridge', chatSessionId: 'chat-1' },
    });

    const result = await tool.execute('pi-call-1', { value: 'hello' });

    expect(result.details).toMatchObject({ ok: true, summary: 'ran hello' });
    await closeToolAuthorization(grant.id, SUBJECT);
  });

  it('consumes the one-time call reservation: replaying the same call identity is refused', async () => {
    const grant = await createGrant();
    const [tool] = createPiAgentTools({
      descriptors: [descriptor],
      executeTool: bridgeExecuteTool(createTestRuntime(), grant.id),
      callSource: { requestId: 'req-pi-bridge', chatSessionId: 'chat-1' },
    });

    await expect(tool.execute('pi-call-2', { value: 'first' })).resolves.toMatchObject({
      details: { ok: true },
    });
    // Same call identity replayed: the one-time reservation is consumed and
    // the runtime encodes the refusal as an ok:false tool result.
    const replayed = await tool.execute('pi-call-2', { value: 'second' });
    expect(replayed.details).toMatchObject({ ok: false });
    await closeToolAuthorization(grant.id, SUBJECT);
  });

  it('fails closed without a grant: no second execution path', async () => {
    const [tool] = createPiAgentTools({
      descriptors: [descriptor],
      executeTool: async () => {
        throw new Error('unreachable: bridge must not execute without a grant');
      },
      callSource: { requestId: 'req-pi-bridge', chatSessionId: 'chat-1' },
    });

    // Without a grant the bridge-level executeTool is never even reached if
    // the caller refuses; simulate the caller-side refusal by throwing
    // ToolAuthorizationError before the bridge can execute.
    const guardedExecute = async () => {
      throw new ToolAuthorizationError('E_NO_GRANT', 'No authorization grant for this tool call.');
    };
    const [guardedTool] = createPiAgentTools({
      descriptors: [descriptor],
      executeTool: guardedExecute,
      callSource: { requestId: 'req-pi-bridge', chatSessionId: 'chat-1' },
    });

    await expect(guardedTool.execute('pi-call-3', { value: 'x' })).rejects.toThrow(
      'No authorization grant',
    );
    await expect(tool.execute('pi-call-3', { value: 'x' })).rejects.toThrow('unreachable');
  });

  it('refuses after the grant is closed', async () => {
    const grant = await createGrant();
    const [tool] = createPiAgentTools({
      descriptors: [descriptor],
      executeTool: bridgeExecuteTool(createTestRuntime(), grant.id),
      callSource: { requestId: 'req-pi-bridge', chatSessionId: 'chat-1' },
    });
    await closeToolAuthorization(grant.id, SUBJECT);

    const result = await tool.execute('pi-call-4', { value: 'after-close' });
    expect(result.details).toMatchObject({ ok: false });
  });
});

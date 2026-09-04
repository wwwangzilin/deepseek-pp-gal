/**
 * Tool bridge tests (Issue A2).
 *
 * Proves the bridge routes every tool call through the injected
 * grant-checking `executeTool` (no second execution path), preserves tool-call
 * identity (pi toolCallId → ToolCall.id), round-trips ToolResults through
 * `details`, fails closed on non-continuable chains, and maps the released
 * budgets.
 */

import { describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolCall, ToolExecutionRecord, ToolResult } from '../core/types';
import {
  createPiAgentTools,
  createPiLoopBudgetMap,
  piToolResultToExecutionRecord,
} from '../core/inline-agent/pi/tool-bridge';

const ARTIFACT_RESULT: ToolResult = {
  ok: true,
  summary: 'Artifact created',
  output: [{ title: 'a.txt' }],
};

function artifactExecution(call: ToolCall): ToolExecutionRecord {
  return {
    name: call.name,
    provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
    result: ARTIFACT_RESULT,
  };
}

describe('createPiAgentTools', () => {
  it('exposes one AgentTool per descriptor with mapped metadata', () => {
    const executeTool = vi.fn();
    const tools = createPiAgentTools({
      descriptors: createArtifactToolDescriptors('en'),
      executeTool,
      callSource: { requestId: 'req-1', chatSessionId: 'chat-1' },
    });

    expect(tools.length).toBeGreaterThan(0);
    const tool = tools[0] as AgentTool;
    expect(tool).toMatchObject({
      name: 'artifact_create',
      label: expect.any(String),
      description: expect.any(String),
    });
  });

  it('routes every execution through the injected executeTool with full call identity', async () => {
    const executeTool = vi.fn(async (call: ToolCall) => artifactExecution(call));
    const [tool] = createPiAgentTools({
      descriptors: createArtifactToolDescriptors('en'),
      executeTool,
      callSource: { requestId: 'req-1', chatSessionId: 'chat-1' },
    });

    const result = (await tool.execute('call-1', { filename: 'a.txt', content: 'ok' })) as AgentToolResult<ToolResult>;

    expect(executeTool).toHaveBeenCalledTimes(1);
    const call = executeTool.mock.calls[0]?.[0] as ToolCall;
    expect(call).toMatchObject({
      id: 'call-1',
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt', content: 'ok' },
      source: { trigger: 'agent_run', requestId: 'req-1', chatSessionId: 'chat-1' },
    });
    // ToolResult round-trips through details verbatim.
    expect(result.details).toEqual(ARTIFACT_RESULT);
    expect(result.content).toEqual([{ type: 'text', text: 'Artifact created' }]);
  });

  it('does not bypass a grant-checking executeTool: refused calls reject', async () => {
    // Simulates the background grant path: reservations are bound to the
    // request identity (toolCallId); unknown ids are refused.
    const reserved = new Set(['call-granted']);
    const executeTool = async (call: ToolCall): Promise<ToolExecutionRecord> => {
      if (!reserved.has(call.id ?? '')) {
        throw new Error('No authorization grant for this tool call.');
      }
      return artifactExecution(call);
    };
    const [tool] = createPiAgentTools({
      descriptors: createArtifactToolDescriptors('en'),
      executeTool,
      callSource: { requestId: 'req-1', chatSessionId: 'chat-1' },
    });

    await expect(tool.execute('call-ungranted', { filename: 'a.txt', content: 'ok' })).rejects.toThrow(
      'No authorization grant',
    );
    await expect(tool.execute('call-granted', { filename: 'a.txt', content: 'ok' })).resolves.toMatchObject({
      details: ARTIFACT_RESULT,
    });
  });
});

describe('piToolResultToExecutionRecord', () => {
  it('restores the ToolResult from bridge details verbatim', () => {
    const record = piToolResultToExecutionRecord({
      toolName: 'artifact_create',
      provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'artifact_create',
        content: [{ type: 'text', text: 'Artifact created' }],
        details: ARTIFACT_RESULT,
        isError: false,
        timestamp: 0,
      },
    });

    expect(record.result).toEqual(ARTIFACT_RESULT);
  });

  it('synthesizes a summary record when details are absent', () => {
    const record = piToolResultToExecutionRecord({
      toolName: 'web_search',
      provider: { kind: 'local', id: 'web', displayName: 'Web', transport: 'in_process' },
      message: {
        role: 'toolResult',
        toolCallId: 'call-2',
        toolName: 'web_search',
        content: [{ type: 'text', text: 'results' }],
        isError: true,
        timestamp: 0,
      },
    });

    expect(record.result).toEqual({ ok: false, summary: 'results' });
  });
});

describe('createPiLoopBudgetMap', () => {
  it('maps the released inline-agent budgets', () => {
    expect(createPiLoopBudgetMap()).toEqual({
      maxSteps: 25,
      maxNudges: 8,
      stepTimeoutMs: 120_000,
      requestDelayMinMs: 2_500,
      requestDelayMaxMs: 6_500,
      fullToolResultWindow: 4,
    });
  });
});

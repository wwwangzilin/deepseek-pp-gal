/**
 * Tool bridge between the pi agent loop and the DeepSeek++ execution surface
 * (Issue A2).
 *
 * Design rules:
 *  - **No second execution path** (AGENTS.md security invariant): every
 *    bridge tool routes through the injected `executeTool`, which is the
 *    grant-checking path owned by the caller (the loop adapter closes over
 *    the background grant in A3). The bridge never bypasses authorization.
 *  - Tool-call identity is preserved end-to-end: the pi `toolCallId` becomes
 *    `ToolCall.id`, so grant one-time reservations bound to request identity
 *    keep working.
 *  - Tool results round-trip exactly: the execution record's `ToolResult` is
 *    carried as `AgentToolResult.details`, and
 *    `piToolResultToExecutionRecord` restores it verbatim for trace/prompt
 *    consumers.
 *  - The DS conversation chain stays the authority: `assertContinuableChain`
 *    fails closed when tool calls arrive without a continuable message id
 *    (chain-fork protection, risk (g)).
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type {
  ToolCall,
  ToolDescriptor,
  ToolExecutionRecord,
  ToolProviderIdentity,
  ToolResult,
} from '../../types';
import { INLINE_AGENT_FULL_TOOL_RESULT_WINDOW } from '../prompt';
import {
  INLINE_AGENT_MAX_NUDGES,
  INLINE_AGENT_MAX_STEPS,
  INLINE_AGENT_REQUEST_DELAY_MAX_MS,
  INLINE_AGENT_REQUEST_DELAY_MIN_MS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
} from '../types';

export interface PiToolBridgeInput {
  descriptors: readonly ToolDescriptor[];
  /** The existing grant-checking execution path. Never bypassed. */
  executeTool: (call: ToolCall) => Promise<ToolExecutionRecord>;
  /**
   * The extension-owned authorization binding for this run. Tool-call
   * sources must match the grant exactly (`requestId`, `chatSessionId`),
   * otherwise the runtime refuses with `tool_session_mismatch`. The loop
   * adapter (A3) supplies the loop's request identity.
   */
  callSource: {
    requestId: string;
    chatSessionId: string;
  };
}

/**
 * Builds pi AgentTools over the existing execution surface. One tool per
 * descriptor, mirroring the current loop: every descriptor the caller
 * exposed becomes a callable tool; authorization is enforced by
 * `executeTool`, not here.
 */
export function createPiAgentTools(input: PiToolBridgeInput): Array<AgentTool<any, ToolResult>> {
  return input.descriptors.map((descriptor) => createPiAgentTool(descriptor, input));
}

/**
 * Restores a ToolExecutionRecord from a pi tool-result message. When the
 * bridge's own `details` round-trip is present (a ToolResult), it is
 * restored verbatim; otherwise a summary record is synthesized from the
 * message content.
 */
export function piToolResultToExecutionRecord(input: {
  toolName: string;
  provider: ToolProviderIdentity;
  message: ToolResultMessage;
}): ToolExecutionRecord {
  const details = input.message.details as ToolResult | undefined;
  if (details && typeof details === 'object' && 'ok' in details) {
    return { name: input.toolName, provider: input.provider, result: details };
  }
  const text = input.message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return {
    name: input.toolName,
    provider: input.provider,
    result: { ok: !input.message.isError, summary: text },
  };
}

/** Budget constants mapped for the pi loop configuration (Issue A2-T2). */
export interface PiLoopBudgetMap {
  maxSteps: number;
  maxNudges: number;
  stepTimeoutMs: number;
  requestDelayMinMs: number;
  requestDelayMaxMs: number;
  fullToolResultWindow: number;
}

/** The released inline-agent budgets, mapped for the pi loop adapter (A3). */
export function createPiLoopBudgetMap(): PiLoopBudgetMap {
  return {
    maxSteps: INLINE_AGENT_MAX_STEPS,
    maxNudges: INLINE_AGENT_MAX_NUDGES,
    stepTimeoutMs: INLINE_AGENT_STEP_TIMEOUT_MS,
    requestDelayMinMs: INLINE_AGENT_REQUEST_DELAY_MIN_MS,
    requestDelayMaxMs: INLINE_AGENT_REQUEST_DELAY_MAX_MS,
    fullToolResultWindow: INLINE_AGENT_FULL_TOOL_RESULT_WINDOW,
  };
}

function createPiAgentTool(
  descriptor: ToolDescriptor,
  input: PiToolBridgeInput,
): AgentTool<any, ToolResult> {
  const { executeTool, callSource } = input;
  return {
    name: descriptor.invocationName,
    label: descriptor.title,
    description: descriptor.description,
    // The descriptor input schema is JSON-schema shaped; pi validates plain
    // JSON schemas without a typebox kind marker (no runtime typebox dep).
    parameters: descriptor.inputSchema as unknown as never,
    prepareArguments: (args) => args as never,
    execute: async (toolCallId, params, _signal, _onUpdate): Promise<AgentToolResult<ToolResult>> => {
      const record = await executeTool({
        id: toolCallId,
        name: descriptor.name,
        invocationName: descriptor.invocationName,
        payload: (params ?? {}) as Record<string, unknown>,
        raw: '',
        source: {
          trigger: 'agent_run',
          requestId: callSource.requestId,
          chatSessionId: callSource.chatSessionId,
        },
      });
      return {
        content: [{ type: 'text', text: record.result.summary ?? '' }],
        details: record.result,
      };
    },
  };
}

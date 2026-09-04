import { describe, expect, it } from 'vitest';
import {
  INCOMPLETE_TOOL_CALL_ERROR_CODE,
  selectContinuableToolDescriptors,
  selectContinuableToolExecutions,
} from '../core/inline-agent/execution-policy';
import {
  createMemoryToolDescriptors,
  MEMORY_TOOL_PROVIDER,
} from '../core/tool/memory';
import type { ToolDescriptor, ToolExecutionRecord } from '../core/types';

describe('inline agent execution policy', () => {
  it('keeps incomplete calls as recovery failures but excludes pending starts', () => {
    const completed = makeExecution();
    const pending = makeExecution({ pending: true });
    const interrupted = makeExecution({
      result: {
        ok: false,
        summary: 'failed',
        error: {
          code: INCOMPLETE_TOOL_CALL_ERROR_CODE,
          message: 'incomplete',
          retryable: false,
        },
      },
    });

    expect(selectContinuableToolExecutions([pending, interrupted, completed])).toEqual([
      interrupted,
      completed,
    ]);
  });

  it('preserves released continuation and drops providers the agent cannot resolve', () => {
    const failed = makeExecution({
      result: {
        ok: false,
        summary: 'provider failed',
        error: { code: 'provider_failed', message: 'failed', retryable: false },
      },
    });
    // A made-up local provider is not in the continuation policy (no MCP/web/
    // browser/memory identity) and cannot be echoed by the inline agent.
    const opaque = makeExecution({
      name: 'opaque_tool',
      provider: { kind: 'local', id: 'opaque', displayName: 'Opaque', transport: 'in_process' },
    });

    expect(selectContinuableToolExecutions([failed, opaque])).toEqual([failed]);
  });

  it('keeps a completed local memory tool execution as continuable', () => {
    // Issue #566: memory_save completed successfully but the inline agent
    // never started, so the round ended without a final reply. A successful
    // local:memory execution must be treated like any other continuable tool.
    const memorySaved = makeExecution({
      name: 'memory_save',
      provider: MEMORY_TOOL_PROVIDER,
      result: { ok: true, summary: '已保存' },
    });

    expect(selectContinuableToolExecutions([memorySaved])).toEqual([memorySaved]);
  });

  it('keeps the memory descriptor so the inline agent can resolve its result', () => {
    // The descriptor filter that feeds the inline agent must mirror the
    // execution policy: an opaque local provider is filtered out but local
    // memory descriptors (memory_save/update/delete) are kept.
    const opaqueDescriptor: ToolDescriptor = {
      id: 'local:opaque:opaque',
      provider: { kind: 'local', id: 'opaque', displayName: 'Opaque', transport: 'in_process' },
      name: 'opaque',
      invocationName: 'opaque',
      title: 'Opaque',
      description: 'Opaque',
      inputSchema: { type: 'object', properties: {} },
      execution: { mode: 'auto', enabled: true, risk: 'low' },
    };

    const kept = selectContinuableToolDescriptors([
      ...createMemoryToolDescriptors('en'),
      opaqueDescriptor,
    ]);

    expect(kept.map((d) => d.name)).toEqual(['memory_save', 'memory_update', 'memory_delete']);
  });
});

function makeExecution(overrides: Partial<ToolExecutionRecord> = {}): ToolExecutionRecord {
  return {
    callId: 'call-1',
    name: 'web_fetch',
    provider: { kind: 'local', id: 'web', displayName: 'Web', transport: 'in_process' },
    result: { ok: true, summary: 'done' },
    ...overrides,
  };
}

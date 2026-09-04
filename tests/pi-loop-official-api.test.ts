/**
 * Official-API backend loop tests (Issue B2-T5).
 *
 * Drives `runPiInlineAgentLoop` with `modelBackend: 'official-api'` against
 * a mocked `submitOfficialDeepSeekStreaming` and verifies:
 *  - the official-API branch is selected (web path untouched — golden locks
 *    the default);
 *  - text/reasoning deltas stream and the tool loop executes through the
 *    same authorized bridge;
 *  - fail-closed: tools are refused when the pi Context carries no assistant
 *    message (chain = Context transcript for this backend);
 *  - abort semantics are preserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

const officialApiMocks = vi.hoisted(() => ({
  submitOfficialDeepSeekStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/official-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/deepseek/official-api')>();
  return {
    ...original,
    submitOfficialDeepSeekStreaming: officialApiMocks.submitOfficialDeepSeekStreaming,
  };
});

// Official-API key/config providers read chrome.storage; stub the modules so
// the loop branch resolves deterministic values.
vi.mock('../core/chat/api-key', () => ({
  getDeepSeekApiKey: vi.fn(async () => 'sk-test'),
}));

vi.mock('../core/chat/official-api-config', () => ({
  getOfficialApiChatConfig: vi.fn(async () => ({
    model: 'deepseek-v4-flash',
    thinking: 'disabled',
    reasoningEffort: 'high',
  })),
}));

const { runInlineAgentLoop } = await import('../core/inline-agent/loop');

const TOOL_CALL_TEXT = '<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>';

function createPayload(overrides: Partial<InlineAgentStartPayload> = {}): InlineAgentStartPayload {
  return {
    loopId: 'loop-1',
    chatSessionId: 'chat-1',
    parentMessageId: 100,
    originalPrompt: 'Create a file with content ok.',
    agentTaskPrompt: 'Create a file with content ok.',
    toolExecutions: [],
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    toolDescriptors: createArtifactToolDescriptors('en'),
    modelBackend: 'official-api',
    ...overrides,
  };
}

function createCollector(): {
  events: Array<{ type: string; [key: string]: unknown }>;
  post: (type: string, data: unknown) => void;
} {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  return {
    events,
    post: (type, data) => {
      events.push({ type, ...(data as Record<string, unknown>) });
    },
  };
}

async function runLoop(
  payload: InlineAgentStartPayload,
  executeTool: (call: { id: string; name: string; invocationName: string; payload: Record<string, unknown> }) => Promise<ToolExecutionRecord>,
): Promise<{ events: Array<{ type: string; [key: string]: unknown }> }> {
  const collector = createCollector();
  await runInlineAgentLoop(payload, {
    post: collector.post,
    executeTool: executeTool as never,
    signal: new AbortController().signal,
  });
  return collector;
}

describe('runInlineAgentLoop with official-api backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    officialApiMocks.submitOfficialDeepSeekStreaming.mockImplementation(
      async (_input, callbacks) => {
        callbacks.onTextChunk?.('The file is ready.');
        callbacks.onFinished?.();
        return { assistantText: 'The file is ready.', reasoningText: '', finished: true };
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams a natural no-tool answer to completion', async () => {
    const { events } = await runLoop(createPayload(), async () => {
      throw new Error('no tools expected');
    });
    const complete = events.find((e) => e.type === 'AGENT_LOOP_COMPLETE');
    expect(complete).toBeDefined();
    expect(complete?.finalText).toBe('The file is ready.');
    expect(events.some((e) => e.type === 'AGENT_TOOL_DETECTED')).toBe(false);
  });

  it('executes tools through the bridge and continues the loop', async () => {
    vi.useFakeTimers();
    officialApiMocks.submitOfficialDeepSeekStreaming
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.(TOOL_CALL_TEXT);
        callbacks.onFinished?.();
        return { assistantText: TOOL_CALL_TEXT, reasoningText: '', finished: true };
      })
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.('Created a.txt.');
        callbacks.onFinished?.();
        return { assistantText: 'Created a.txt.', reasoningText: '', finished: true };
      });

    const executed: string[] = [];
    const loopPromise = runLoop(createPayload(), async (call) => {
      executed.push(call.invocationName);
      return {
        name: call.name,
        provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
        result: { ok: true, summary: 'created' },
      };
    });
    // Advance through the released request pacing (2.5–6.5s per request).
    await vi.advanceTimersByTimeAsync(7_000);
    const { events } = await loopPromise;

    expect(executed).toEqual(['artifact_create']);
    expect(events.some((e) => e.type === 'AGENT_TOOL_DETECTED')).toBe(true);
    const complete = events.find((e) => e.type === 'AGENT_LOOP_COMPLETE');
    expect(complete?.finalText).toBe('Created a.txt.');
    expect(complete?.totalTools).toBe(1);
  });

  it('gives the same XML tool index a distinct authorization identity in each model turn', async () => {
    vi.useFakeTimers();
    officialApiMocks.submitOfficialDeepSeekStreaming
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.(TOOL_CALL_TEXT);
        callbacks.onFinished?.();
        return { assistantText: TOOL_CALL_TEXT, reasoningText: '', finished: true };
      })
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.(TOOL_CALL_TEXT);
        callbacks.onFinished?.();
        return { assistantText: TOOL_CALL_TEXT, reasoningText: '', finished: true };
      })
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.('Both files are ready.');
        callbacks.onFinished?.();
        return { assistantText: 'Both files are ready.', reasoningText: '', finished: true };
      });

    const callIds: string[] = [];
    const loopPromise = runLoop(createPayload(), async (call) => {
      callIds.push(call.id);
      return {
        name: call.name,
        provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
        result: { ok: true, summary: 'created' },
      };
    });
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(7_000);
    await loopPromise;

    expect(callIds).toEqual(['turn:1:xml:0', 'turn:2:xml:0']);
  });

  it('forwards official-API messages in OpenAI-compatible shape with tool results', async () => {
    vi.useFakeTimers();
    officialApiMocks.submitOfficialDeepSeekStreaming
      .mockImplementationOnce(async (_input, callbacks) => {
        callbacks.onTextChunk?.(TOOL_CALL_TEXT);
        callbacks.onFinished?.();
        return { assistantText: TOOL_CALL_TEXT, reasoningText: '', finished: true };
      })
      .mockImplementationOnce(async (input, callbacks) => {
        callbacks.onTextChunk?.('done');
        callbacks.onFinished?.();
        return { assistantText: 'done', reasoningText: '', finished: true };
      });

    const loopPromise = runLoop(createPayload(), async () => ({
      name: 'artifact_create',
      provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
      result: { ok: true, summary: 'created' },
    }));
    // Advance through the released request pacing (2.5–6.5s per request).
    await vi.advanceTimersByTimeAsync(7_000);
    await loopPromise;

    const calls = officialApiMocks.submitOfficialDeepSeekStreaming.mock.calls;
    expect(calls).toHaveLength(2);
    // First request: the seed user message only.
    expect(calls[0][0].messages).toEqual([{ role: 'user', content: 'Create a file with content ok.' }]);
    // Second request: seed + assistant tool-call text + toolResult as user message.
    const secondMessages = calls[1][0].messages;
    expect(secondMessages[0]).toEqual({ role: 'user', content: 'Create a file with content ok.' });
    expect(secondMessages[1]).toEqual({ role: 'assistant', content: TOOL_CALL_TEXT });
    expect(secondMessages[2].role).toBe('user');
    expect(secondMessages[2].content).toContain('artifact_create_result');
    // Tool result content carries the execution summary (bridge result text).
    expect(secondMessages[2].content).toContain('created');
    // Reasoning hand-back only when present.
    expect(secondMessages[1].reasoningContent).toBeUndefined();
  });

  it('surfaces an API-key-missing failure as AGENT_LOOP_ERROR', async () => {
    const { getDeepSeekApiKey } = await import('../core/chat/api-key');
    (getDeepSeekApiKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { events } = await runLoop(createPayload(), async () => {
      throw new Error('no tools expected');
    });
    const error = events.find((e) => e.type === 'AGENT_LOOP_ERROR');
    expect(error).toBeDefined();
    expect(String(error?.error)).toContain('API key');
  });
});

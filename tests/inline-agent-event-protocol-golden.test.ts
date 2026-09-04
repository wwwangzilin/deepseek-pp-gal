/**
 * AGENT_* loop event protocol — golden contract.
 *
 * Issue A0-T1: freezes the complete event sequence (type + normalized payload)
 * emitted by `runInlineAgentLoop` for representative scenarios BEFORE the loop
 * engine is replaced by @earendil-works/pi-agent-core (Issue A3).
 *
 * The replacement must reproduce these sequences unchanged: the golden is the
 * byte-level parity baseline for the swap. When A3 lands, this test runs
 * against the new engine with the same adapter mock seam
 * (`vi.mock('../core/deepseek/adapter')`), so every scenario remains valid.
 *
 * Normalization policy (documented, deterministic):
 * - `AGENT_STREAM_CHUNK.fullText` longer than 10_000 chars is replaced by a
 *   `[long-text:<length>]` marker so the golden stays readable; length is the
 *   contract (12_000-char clamp + `\n...[truncated]` suffix for stream events,
 *   unclamped final text on `AGENT_LOOP_COMPLETE`).
 * - `AGENT_REASONING_CHUNK.fullText` follows the same `[long-text:<length>]`
 *   marker rule (same 12_000-char clamp).
 * - `AGENT_TOOL_DETECTED.call` keeps `{name, invocationName, payload}` only;
 *   volatile fields (id/raw/provider/parseError) are not part of the contract.
 * - `AGENT_STEP_COMPLETE.toolExecutions` keeps the full released record
 *   surface: `{name, ok, summary, detail, output, error, truncated}` (fields
 *   absent from the record stay absent; undefined fields are not compared).
 * - All other payload fields are compared exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolCall, ToolExecutionRecord } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { runInlineAgentLoop } = await import('../core/inline-agent/loop');

const LONG_TEXT_THRESHOLD = 10_000;
const TRUNCATION_SUFFIX = '\n...[truncated]';
const BUDGET_NOTICE_1 =
  'DeepSeek++ paused after 1 automated tool-continuation rounds to avoid presenting incomplete work as a final answer. Send "continue" in this conversation to resume the remaining work.';

interface NormalizedEvent {
  type: string;
  [key: string]: unknown;
}

type Post = (type: string, data: unknown) => void;

function normalizeEvent(type: string, data: unknown): NormalizedEvent {
  const payload = data as Record<string, unknown>;
  switch (type) {
    case 'AGENT_STEP_STARTED':
      return { type, loopId: payload.loopId, stepIndex: payload.stepIndex };
    case 'AGENT_STREAM_CHUNK': {
      const fullText = payload.fullText as string;
      return {
        type,
        loopId: payload.loopId,
        stepIndex: payload.stepIndex,
        text: payload.text,
        fullText: fullText.length > LONG_TEXT_THRESHOLD ? `[long-text:${fullText.length}]` : fullText,
      };
    }
    case 'AGENT_REASONING_CHUNK': {
      const fullText = payload.fullText as string;
      return {
        type,
        loopId: payload.loopId,
        stepIndex: payload.stepIndex,
        fullText: fullText.length > LONG_TEXT_THRESHOLD ? `[long-text:${fullText.length}]` : fullText,
      };
    }
    case 'AGENT_TOOL_DETECTED': {
      const call = payload.call as ToolCall;
      return {
        type,
        loopId: payload.loopId,
        stepIndex: payload.stepIndex,
        call: { name: call.name, invocationName: call.invocationName, payload: call.payload },
      };
    }
    case 'AGENT_STEP_COMPLETE':
      return {
        type,
        loopId: payload.loopId,
        stepIndex: payload.stepIndex,
        responseMessageId: payload.responseMessageId,
        toolExecutions: (payload.toolExecutions as ToolExecutionRecord[]).map((e) => ({
          name: e.name,
          ok: e.result.ok,
          summary: e.result.summary,
          detail: e.result.detail,
          output: e.result.output,
          error: e.result.error,
          truncated: e.result.truncated,
        })),
      };
    case 'AGENT_LOOP_COMPLETE': {
      const finalText = payload.finalText as string;
      return {
        type,
        loopId: payload.loopId,
        totalSteps: payload.totalSteps,
        totalTools: payload.totalTools,
        finalText: finalText.length > LONG_TEXT_THRESHOLD ? `[long-text:${finalText.length}]` : finalText,
      };
    }
    case 'AGENT_LOOP_ERROR':
      return {
        type,
        loopId: payload.loopId,
        stepIndex: payload.stepIndex,
        totalTools: payload.totalTools,
        error: payload.error,
      };
    default:
      return { type, ...payload };
  }
}

function createCollector(): { events: NormalizedEvent[]; post: Post } {
  const events: NormalizedEvent[] = [];
  return {
    events,
    post: (type, data) => events.push(normalizeEvent(type, data)),
  };
}

function abortAwarePendingTurn(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

const TOOL_CALL_TEXT = '<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>';
const DSML_CALL_TEXT =
  '<｜DSML｜tool_calls><｜DSML｜invoke name="artifact_create">' +
  '<｜DSML｜parameter name="filename" string="true">a.txt</｜DSML｜parameter>' +
  '<｜DSML｜parameter name="content" string="true">ok</｜DSML｜parameter>' +
  '</｜DSML｜invoke></｜DSML｜tool_calls>';

const ARTIFACT_EXECUTION: ToolExecutionRecord = {
  name: 'artifact_create',
  provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
  result: { ok: true, summary: 'Artifact created' },
};

describe('AGENT_* event protocol golden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('G1 natural completion: single turn, no tools, no nudge', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
    });

    const { events, post } = createCollector();
    await runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: new AbortController().signal });

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: 'Done after tool result.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 0, responseMessageId: 102, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 1, totalTools: 1, finalText: 'Done after tool result.' },
    ]);
  });

  it('G2 tool execution: streamed XML tool call, execute, then natural answer', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(TOOL_CALL_TEXT);
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('All done.');
        return { assistantText: '', responseMessageId: 103, requestMessageId: 102, finished: true };
      });

    const { events, post } = createCollector();
    const executeTool = vi.fn(async () => ARTIFACT_EXECUTION);

    const run = runInlineAgentLoop(
      { ...createPayload(), toolDescriptors: createArtifactToolDescriptors('en') },
      { post, executeTool, signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      {
        type: 'AGENT_TOOL_DETECTED',
        loopId: 'loop-1',
        stepIndex: 0,
        call: { name: 'artifact_create', invocationName: 'artifact_create', payload: { filename: 'a.txt', content: 'ok' } },
      },
      {
        type: 'AGENT_STEP_COMPLETE',
        loopId: 'loop-1',
        stepIndex: 0,
        responseMessageId: 102,
        toolExecutions: [{ name: 'artifact_create', ok: true, summary: 'Artifact created' }],
      },
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 1 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 1, text: '', fullText: 'All done.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 1, responseMessageId: 103, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 2, totalTools: 2, finalText: 'All done.' },
    ]);
  });

  it('G3 completion without continuable message id: streamed text is final', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Here is the final answer.');
      return { assistantText: '', responseMessageId: null, requestMessageId: 101, finished: true };
    });

    const { events, post } = createCollector();
    await runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: new AbortController().signal });

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: 'Here is the final answer.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 0, responseMessageId: null, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 1, totalTools: 1, finalText: 'Here is the final answer.' },
    ]);
  });

  it('G4 nudge chain: planning text nudges, nudge turn executes a tool, next step completes', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call search next.');
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(TOOL_CALL_TEXT);
        return { assistantText: '', responseMessageId: 104, requestMessageId: 103, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('All done.');
        return { assistantText: '', responseMessageId: 105, requestMessageId: 104, finished: true };
      });

    const { events, post } = createCollector();
    const executeTool = vi.fn(async () => ARTIFACT_EXECUTION);

    const run = runInlineAgentLoop(
      { ...createPayload(), toolDescriptors: createArtifactToolDescriptors('en') },
      { post, executeTool, signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: 'I will call search next.' },
      {
        type: 'AGENT_TOOL_DETECTED',
        loopId: 'loop-1',
        stepIndex: 0,
        call: { name: 'artifact_create', invocationName: 'artifact_create', payload: { filename: 'a.txt', content: 'ok' } },
      },
      {
        type: 'AGENT_STEP_COMPLETE',
        loopId: 'loop-1',
        stepIndex: 0,
        responseMessageId: 104,
        toolExecutions: [{ name: 'artifact_create', ok: true, summary: 'Artifact created' }],
      },
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 1 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 1, text: '', fullText: 'All done.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 1, responseMessageId: 105, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 2, totalTools: 2, finalText: 'All done.' },
    ]);
  });

  it('G5 nudge budget: second no-tool nudge answer stops with the budget notice', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call search next.');
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I still need to call search next.');
        return { assistantText: '', responseMessageId: 104, requestMessageId: 103, finished: true };
      });

    const { events, post } = createCollector();

    const run = runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: 'I will call search next.' },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: 'I still need to call search next.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 0, responseMessageId: 104, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 1, totalTools: 1, finalText: BUDGET_NOTICE_1 },
    ]);
  });

  it('G6 user abort mid-step: silent completion with empty final text', async () => {
    const controller = new AbortController();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      abortAwarePendingTurn(signal));

    const { events, post } = createCollector();
    const run = runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: controller.signal });
    controller.abort();
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 0, totalTools: 1, finalText: '' },
    ]);
  });

  it('G7 error path: empty continuation without continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async () => ({
      assistantText: '',
      responseMessageId: null,
      requestMessageId: 101,
      finished: true,
    }));

    const { events, post } = createCollector();
    await runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: new AbortController().signal });

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      {
        type: 'AGENT_LOOP_ERROR',
        loopId: 'loop-1',
        stepIndex: 0,
        totalTools: 1,
        error: 'DeepSeek returned an empty agent continuation without a continuable response message.',
      },
    ]);
  });

  it('G8a DSML legacy fallback: legacy tool call detected via fallback parse', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(DSML_CALL_TEXT);
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('All done.');
        return { assistantText: '', responseMessageId: 103, requestMessageId: 102, finished: true };
      });

    const { events, post } = createCollector();
    const executeTool = vi.fn(async () => ARTIFACT_EXECUTION);

    const run = runInlineAgentLoop(
      { ...createPayload(), toolDescriptors: createArtifactToolDescriptors('en') },
      { post, executeTool, signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      {
        type: 'AGENT_TOOL_DETECTED',
        loopId: 'loop-1',
        stepIndex: 0,
        call: { name: 'artifact_create', invocationName: 'artifact_create', payload: { filename: 'a.txt', content: 'ok' } },
      },
      {
        type: 'AGENT_STEP_COMPLETE',
        loopId: 'loop-1',
        stepIndex: 0,
        responseMessageId: 102,
        toolExecutions: [{ name: 'artifact_create', ok: true, summary: 'Artifact created' }],
      },
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 1 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 1, text: '', fullText: 'All done.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 1, responseMessageId: 103, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 2, totalTools: 2, finalText: 'All done.' },
    ]);
  });

  it('G10 reasoning: per-turn thinking deltas stream as AGENT_REASONING_CHUNK', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onReasoningChunk?.('我', '我');
        handlers.onReasoningChunk?.('先分析', '我先分析');
        handlers.onTextChunk(TOOL_CALL_TEXT);
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onReasoningChunk?.('最后检查', '最后检查');
        handlers.onTextChunk('All done.');
        return { assistantText: '', responseMessageId: 103, requestMessageId: 102, finished: true };
      });

    const { events, post } = createCollector();
    const executeTool = vi.fn(async () => ARTIFACT_EXECUTION);

    const run = runInlineAgentLoop(
      { ...createPayload(), toolDescriptors: createArtifactToolDescriptors('en') },
      { post, executeTool, signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_REASONING_CHUNK', loopId: 'loop-1', stepIndex: 0, fullText: '我' },
      { type: 'AGENT_REASONING_CHUNK', loopId: 'loop-1', stepIndex: 0, fullText: '我先分析' },
      { type: 'AGENT_TOOL_DETECTED', loopId: 'loop-1', stepIndex: 0, call: {
        name: 'artifact_create',
        invocationName: 'artifact_create',
        payload: { filename: 'a.txt', content: 'ok' },
      } },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 0, responseMessageId: 102, toolExecutions: [{
        name: 'artifact_create',
        ok: true,
        summary: 'Artifact created',
      }] },
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 1 },
      { type: 'AGENT_REASONING_CHUNK', loopId: 'loop-1', stepIndex: 1, fullText: '最后检查' },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 1, text: '', fullText: 'All done.' },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 1, responseMessageId: 103, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 2, totalTools: 2, finalText: 'All done.' },
    ]);
  });

  it('G9 full tool record: STEP_COMPLETE carries detail/output/error/truncated verbatim', async () => {
    vi.useFakeTimers();
    const fullExecution: ToolExecutionRecord = {
      name: 'artifact_create',
      provider: { kind: 'local', id: 'artifact', displayName: 'Artifact', transport: 'in_process' },
      result: {
        ok: false,
        summary: 'Artifact failed',
        detail: 'disk full',
        output: [{ title: 'attempt-1' }],
        error: { code: 'E_DISK', message: 'No space left', retryable: true },
        truncated: true,
      },
    };
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(TOOL_CALL_TEXT);
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('All done.');
        return { assistantText: '', responseMessageId: 103, requestMessageId: 102, finished: true };
      });

    const { events, post } = createCollector();
    const executeTool = vi.fn(async () => fullExecution);

    const run = runInlineAgentLoop(
      { ...createPayload(), toolDescriptors: createArtifactToolDescriptors('en') },
      { post, executeTool, signal: new AbortController().signal },
    );
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    const stepComplete = events.find((e) => e.type === 'AGENT_STEP_COMPLETE');
    expect(stepComplete).toMatchObject({
      type: 'AGENT_STEP_COMPLETE',
      stepIndex: 0,
      responseMessageId: 102,
      toolExecutions: [
        {
          name: 'artifact_create',
          ok: false,
          summary: 'Artifact failed',
          detail: 'disk full',
          output: [{ title: 'attempt-1' }],
          error: { code: 'E_DISK', message: 'No space left', retryable: true },
          truncated: true,
        },
      ],
    });
  });

  it('G8b stream-event truncation: 12k clamp on STREAM_CHUNK, unclamped final text', async () => {
    const longAnswer = 'x'.repeat(13_000);
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(longAnswer);
      return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
    });

    const { events, post } = createCollector();
    await runInlineAgentLoop(createPayload(), { post, executeTool: vi.fn(), signal: new AbortController().signal });

    expect(events).toEqual([
      { type: 'AGENT_STEP_STARTED', loopId: 'loop-1', stepIndex: 0 },
      { type: 'AGENT_STREAM_CHUNK', loopId: 'loop-1', stepIndex: 0, text: '', fullText: `[long-text:${12_000 + TRUNCATION_SUFFIX.length}]` },
      { type: 'AGENT_STEP_COMPLETE', loopId: 'loop-1', stepIndex: 0, responseMessageId: 102, toolExecutions: [] },
      { type: 'AGENT_LOOP_COMPLETE', loopId: 'loop-1', totalSteps: 1, totalTools: 1, finalText: '[long-text:13000]' },
    ]);
  });
});

function createPayload(): InlineAgentStartPayload {
  return {
    loopId: 'loop-1',
    chatSessionId: 'chat-1',
    parentMessageId: 100,
    originalPrompt: 'Use the tool and summarize the result.',
    agentTaskPrompt: 'Use the tool and summarize the result.',
    toolExecutions: [SUCCESS_EXECUTION],
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    toolDescriptors: [],
    locale: 'en',
  };
}

const SUCCESS_EXECUTION: ToolExecutionRecord = {
  name: 'web_search',
  provider: {
    kind: 'local',
    id: 'web',
    displayName: 'DeepSeek++ Web Search',
    transport: 'in_process',
  },
  result: {
    ok: true,
    summary: 'Search completed',
    output: [{ title: 'Result', url: 'https://example.com' }],
  },
};

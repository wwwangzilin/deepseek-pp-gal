import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createMemoryToolDescriptors } from '../core/tool/memory';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

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

describe('runInlineAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a natural no-tool answer instead of injecting a final-answer round', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'Done after tool result.',
      totalTools: 1,
    }));
  });

  it('keeps sending searchEnabled: true on continuation requests', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop({
      ...createPayload(),
      promptOptions: {
        ...createPayload().promptOptions,
        searchEnabled: true,
      },
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPromptStreaming.mock.calls[0]?.[0]).toMatchObject({
      searchEnabled: true,
    });
  });

  it('does not replay the same step when planning text is followed by a complete answer', async () => {
    const answer = [
      '要求查看贵金属走势，之前的搜索已经提供了一些结果。我需要基于这些结果给出一个全面的回答。',
      '为了更全面地获取信息，我将同时打开这些相关的链接。',
      '',
      '根据截至2026年6月下旬的多份市场分析，贵金属市场在经历前期暴涨后，已进入高位震荡与分化的新阶段。',
      '',
      '### 黄金',
      '黄金短期震荡，但长期逻辑仍受央行购金和避险需求支撑。',
      '',
      '总的来看，黄金偏震荡，白银和铂金更受产业需求影响。',
    ].join('\n');

    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(answer);
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: answer,
      totalSteps: 1,
      totalTools: 1,
    }));
  });

  it('pauses instead of presenting pending nudge text as the final answer', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call search next.');
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I still need to call search next.');
        return {
          assistantText: '',
          responseMessageId: 104,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPromptStreaming.mock.calls[1]?.[0].prompt)
      .toContain('This is no-tool-call correction attempt 1.');
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: expect.stringContaining('paused after 1 automated tool-continuation round'),
      totalTools: 1,
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'I still need to call search next.',
    }));
  });

  it('completes with the streamed text when the response omits a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Here is the final answer.');
      return {
        assistantText: '',
        responseMessageId: null,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'Here is the final answer.',
      totalSteps: 1,
    }));
  });

  it('fails visibly when the response is empty and omits a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async () => ({
      assistantText: '',
      responseMessageId: null,
      requestMessageId: 101,
      finished: true,
    }));

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('empty agent continuation'),
    }));
  });

  it('refuses to execute tool calls returned without a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>');
      return {
        assistantText: '',
        responseMessageId: null,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop({
      ...createPayload(),
      toolDescriptors: createArtifactToolDescriptors('en'),
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('without a continuable response message'),
    }));
  });

  it('refuses to execute nudge tool calls returned without a continuable message id', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call artifact_create next.');
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>');
        return {
          assistantText: '',
          responseMessageId: null,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop({
      ...createPayload(),
      toolDescriptors: createArtifactToolDescriptors('en'),
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('nudge tool calls without a continuable response message'),
    }));
  });

  it('nudges a turn whose visible tail promises a deliverable after retired artifact XML', async () => {
    // Issue (artifact deliverable silently swallowed): the model emits
    // `<artifact_create>` XML (retired internal protocol, not in the loop
    // catalog), the display layer strips it, and the user is left with an
    // empty promise ("现在为你创建…"). The nudge decision must run on the
    // USER-VISIBLE text, so this turn is nudged into a renderable re-delivery
    // instead of completing silently.
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(
          '现在为你创建一份包含折线图和增速分析的可视化报告。\n' +
          '<artifact_create>{"filename":"report.html","content":"<h1>报告</h1>"}</artifact_create>',
        );
        return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('```html\n<h1>报告</h1>\n```');
        return { assistantText: '', responseMessageId: 103, requestMessageId: 102, finished: true };
      });

    const post = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool: vi.fn(),
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(7_000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    // The nudge prompt shows the model the USER-VISIBLE tail: the empty
    // promise, with the retired protocol bytes removed.
    const nudgePrompt = adapterMocks.submitPromptStreaming.mock.calls[1][0].prompt as string;
    expect(nudgePrompt).toContain('现在为你创建一份包含折线图和增速分析的可视化报告。');
    expect(nudgePrompt).not.toContain('artifact_create');
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: '```html\n<h1>报告</h1>\n```',
      totalSteps: 1,
    }));
  });

  it('completes without nudging when a renderable deliverable follows the promise', async () => {
    // A promise followed by an actual fenced deliverable is a complete turn:
    // the tail is a renderable body, not an empty promise.
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk([
        '现在为你创建以下可视化报告：',
        '',
        '```html',
        '<h1>报告</h1>',
        '```',
      ].join('\n'));
      return { assistantText: '', responseMessageId: 102, requestMessageId: 101, finished: true };
    });

    const post = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: '现在为你创建以下可视化报告：\n\n```html\n<h1>报告</h1>\n```',
      totalSteps: 1,
    }));
  });

  it('retries a timed-out step once when no text was received, then reports the timeout', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      abortAwarePendingTurn(signal));

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: 'DeepSeek agent step timed out after retry.',
    }));
  });

  it('does not retry a timed-out step after text was already received', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, handlers, signal) => {
      handlers.onTextChunk('partial answer...');
      return abortAwarePendingTurn(signal);
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: 'DeepSeek agent step timed out while streaming; the response was interrupted.',
    }));
  });

  it('keeps a user abort mid-step silent with an empty final text', async () => {
    const controller = new AbortController();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      abortAwarePendingTurn(signal));

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: controller.signal,
    });
    controller.abort();
    await run;

    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: '',
      totalSteps: 0,
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.anything());
  });

  it('nudges a "让我再抓取" continuation sentence instead of stopping the run', async () => {
    // Reproducible mid-output stop: a turn that ends with a common Chinese
    // first-person continuation sentence ("让我再抓取…获取更完整的月度数据。")
    // promised further tool work but was previously treated as a completed
    // final answer, so the whole run stopped on a message that read as
    // normal. The detector must nudge exactly like "我会调用 …" phrasings.
    const pendingSentence = '基于已有搜索结果，我已经获得了大量数据。让我再抓取雪球那篇详尽的24个月梳理文章，获取更完整的月度数据。';
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk(pendingSentence);
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('<task_complete>{"summary":"完整月度数据已整理完成。"}</task_complete>');
        return {
          assistantText: '',
          responseMessageId: 104,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(7000);
    await run;

    // The nudge turn was issued instead of silently ending on the sentence.
    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPromptStreaming.mock.calls[1]?.[0].prompt)
      .toContain('This is no-tool-call correction attempt 1.');
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: pendingSentence,
    }));
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: expect.stringContaining('完整月度数据已整理完成'),
      totalTools: 1,
    }));
  });

  it('fails visibly when the response stream ends without FINISHED', async () => {
    // A server-side cut (connection dropped, response interrupted) ends the
    // SSE stream without the terminal FINISHED patches. The partial text must
    // never be presented as a finished turn: the loop reports AGENT_LOOP_ERROR
    // with the interruption instead of stopping on a seemingly normal message.
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('让我再抓取雪球那篇详尽的24个月梳理文章');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: false,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('response stream ended before completion'),
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: expect.stringContaining('让我再抓取'),
    }));
  });

  it('completes with a final reply after a memory-only tool round', async () => {
    // Issue #566: a memory_save round used to end without a final reply because
    // the continuation policy filtered local:memory out. Once the loop runs, the
    // pi engine naturally produces the final answer after the memory result.
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('已为你记下这条偏好，后续会沿用。');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();

    await runInlineAgentLoop({
      ...createPayload(),
      toolExecutions: [MEMORY_SAVE_EXECUTION],
      toolDescriptors: createMemoryToolDescriptors('en'),
    }, {
      post,
      executeTool: vi.fn(),
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: '已为你记下这条偏好，后续会沿用。',
      totalTools: 1,
    }));
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

const MEMORY_SAVE_EXECUTION: ToolExecutionRecord = {
  name: 'memory_save',
  provider: {
    kind: 'local',
    id: 'memory',
    displayName: 'DeepSeek++ Memory',
    transport: 'in_process',
  },
  result: {
    ok: true,
    summary: '已保存',
    output: { id: 1 },
  },
};

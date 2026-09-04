import { describe, expect, it } from 'vitest';
import {
  getInlineAgentNativeHistoryResponseId,
  isInlineAgentNativeHistoryBackedTrace,
  shouldReloadInlineAgentNativeHistory,
} from '../core/inline-agent/native-history';
import type { InlineAgentTraceRecord } from '../core/inline-agent/types';

function trace(
  overrides: Partial<InlineAgentTraceRecord> = {},
): InlineAgentTraceRecord {
  return {
    id: 'trace-1',
    loopId: 'loop-1',
    chatSessionId: 'session-1',
    anchorMessageId: 10,
    url: 'https://chat.deepseek.com/a/chat/s/session-1',
    originalPrompt: 'task',
    agentTaskPrompt: 'task',
    status: 'complete',
    steps: [{
      index: 0,
      status: 'complete',
      text: 'final',
      toolExecutions: [],
      responseMessageId: 42,
      collapsed: true,
    }],
    totalSteps: 1,
    totalTools: 0,
    finalText: 'final',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('inline-agent native history ownership', () => {
  it('uses only the final positive DeepSeek response id as history evidence', () => {
    expect(getInlineAgentNativeHistoryResponseId(trace())).toBe(42);
    expect(isInlineAgentNativeHistoryBackedTrace(trace())).toBe(true);
    expect(getInlineAgentNativeHistoryResponseId(trace({ status: 'running' }))).toBeNull();
    expect(getInlineAgentNativeHistoryResponseId(trace({
      steps: [{
        ...trace().steps[0],
        responseMessageId: -42,
      }],
    }))).toBeNull();
    expect(getInlineAgentNativeHistoryResponseId(trace({
      steps: [
        { ...trace().steps[0], responseMessageId: 42 },
        { ...trace().steps[0], index: 1, responseMessageId: null },
      ],
    }))).toBeNull();
  });

  it('reloads only a completed visible web session with a persisted native response', () => {
    const base = {
      modelBackend: 'web' as const,
      budgetPaused: false,
      finalText: '```html\n<h1>ok</h1>\n```',
      trace: trace(),
      visibleChatSessionId: 'session-1',
    };
    expect(shouldReloadInlineAgentNativeHistory(base)).toBe(true);
    expect(shouldReloadInlineAgentNativeHistory({
      ...base,
      modelBackend: 'official-api',
    })).toBe(false);
    expect(shouldReloadInlineAgentNativeHistory({
      ...base,
      budgetPaused: true,
    })).toBe(false);
    expect(shouldReloadInlineAgentNativeHistory({
      ...base,
      finalText: '   ',
    })).toBe(false);
    expect(shouldReloadInlineAgentNativeHistory({
      ...base,
      visibleChatSessionId: 'other-session',
    })).toBe(false);
    expect(shouldReloadInlineAgentNativeHistory({
      ...base,
      trace: trace({ steps: [{ ...trace().steps[0], responseMessageId: null }] }),
    })).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  bindNewChatToolCallToBrowserSession,
} from '../entrypoints/content/tool-session-binding';
import type { ToolCall } from '../core/types';

const TOOL_CALL: ToolCall = {
  id: 'call-1',
  name: 'web_search',
  payload: { query: 'DeepSeek++' },
  raw: '<web_search>{"query":"DeepSeek++"}</web_search>',
  source: {
    trigger: 'manual_chat',
    requestId: 'request-1',
    chatSessionId: 'page-claimed-session',
  },
};

describe('content new-chat tool session binding', () => {
  it('replaces a page session claim only after the browser-owned route arrives', async () => {
    const target = new EventTarget();
    let browserSessionId: string | null = null;
    const pending = bindNewChatToolCallToBrowserSession(TOOL_CALL, null, {
      target,
      timeoutMs: 100,
      readChatSessionId: () => browserSessionId,
    });

    browserSessionId = 'browser-session';
    target.dispatchEvent(new Event('dpp:navigation'));

    await expect(pending).resolves.toEqual({
      ...TOOL_CALL,
      source: {
        ...TOOL_CALL.source,
        chatSessionId: 'browser-session',
      },
    });
    expect(TOOL_CALL.source?.chatSessionId).toBe('page-claimed-session');
  });

  it('does not delay or rewrite a grant that is already browser-bound', async () => {
    const result = await bindNewChatToolCallToBrowserSession(TOOL_CALL, 'existing-session', {
      readChatSessionId: () => 'other-session',
    });

    expect(result).toBe(TOOL_CALL);
  });

  it('refuses to prepare a new-chat execution when no browser-owned route appears', async () => {
    vi.useFakeTimers();
    try {
      const pending = bindNewChatToolCallToBrowserSession(TOOL_CALL, null, {
        target: new EventTarget(),
        timeoutMs: 100,
        readChatSessionId: () => null,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting when the content lifecycle is aborted', async () => {
    const abort = new AbortController();
    const pending = bindNewChatToolCallToBrowserSession(TOOL_CALL, null, {
      target: new EventTarget(),
      signal: abort.signal,
      readChatSessionId: () => null,
    });

    abort.abort();

    await expect(pending).resolves.toBeNull();
  });
});

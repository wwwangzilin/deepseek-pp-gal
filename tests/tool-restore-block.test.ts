import { describe, expect, it } from 'vitest';
import {
  createToolRestoreBlockId,
  createToolRestoreBlockUrl,
} from '../core/tool/restore-block';

describe('tool restore block identity', () => {
  it('keeps one stable restore id for a streamed response as content and assistant ids change', () => {
    const first = createToolRestoreBlockId({
      requestId: 'req-1',
      chatSessionId: 'session-a',
      parentMessageId: 10,
      fallbackUrl: 'https://chat.deepseek.com/a/chat/s/session-a',
      fallbackSeed: 'first tool output',
    });
    const completed = createToolRestoreBlockId({
      requestId: 'req-1',
      chatSessionId: 'session-a',
      parentMessageId: 10,
      fallbackUrl: 'https://chat.deepseek.com/a/chat/s/session-a',
      fallbackSeed: 'final answer with more tool output',
    });

    expect(completed).toBe(first);
  });

  it('derives a session URL from the source chat session instead of the current route', () => {
    const url = createToolRestoreBlockUrl({
      origin: 'https://chat.deepseek.com',
      pathname: '/a/chat/s/current-session',
      search: '?from=sidebar',
      chatSessionId: 'original/session',
    });

    expect(url).toBe('https://chat.deepseek.com/a/chat/s/original%2Fsession');
  });

  it('falls back to the current full route when there is no chat session id', () => {
    const url = createToolRestoreBlockUrl({
      origin: 'https://chat.deepseek.com',
      pathname: '/a/chat',
      search: '?q=1',
      chatSessionId: null,
    });

    expect(url).toBe('https://chat.deepseek.com/a/chat?q=1');
  });
});

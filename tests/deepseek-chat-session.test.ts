import { describe, expect, it } from 'vitest';
import { readDeepSeekChatSessionId } from '../core/deepseek/chat-session';

describe('DeepSeek chat session route', () => {
  it.each([
    ['https://chat.deepseek.com/a/chat/s/session-1', 'session-1'],
    ['https://chat.deepseek.com/chat/s/session%202', 'session 2'],
    ['/a/chat/s/session-3?from=history', 'session-3'],
    ['/a/chat/s/%E0%A4%A', null],
    ['/a/chat/s/', null],
    ['/prefix/a/chat/s/session-4', null],
  ])('reads %s as %s', (route, expected) => {
    expect(readDeepSeekChatSessionId(route)).toBe(expected);
  });
});

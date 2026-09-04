import { describe, expect, it } from 'vitest';
import { shouldSubmitChatComposer } from '../entrypoints/sidepanel/chat-composer';

describe('sidepanel chat composer keyboard handling', () => {
  it('submits a plain Enter key press', () => {
    expect(shouldSubmitChatComposer({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
    })).toBe(true);
  });

  it('does not submit while an IME composition is active', () => {
    expect(shouldSubmitChatComposer({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      keyCode: 13,
    })).toBe(false);
  });

  it('does not submit legacy IME key events reported with keyCode 229', () => {
    expect(shouldSubmitChatComposer({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 229,
    })).toBe(false);
  });

  it('keeps Shift+Enter and non-Enter keys as editor input', () => {
    expect(shouldSubmitChatComposer({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
      keyCode: 13,
    })).toBe(false);
    expect(shouldSubmitChatComposer({
      key: 'a',
      shiftKey: false,
      isComposing: false,
      keyCode: 65,
    })).toBe(false);
  });
});

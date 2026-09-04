import { describe, expect, it } from 'vitest';
import {
  elementHasMessageId,
  findAssistantMessageByContentSnippet,
  findInlineAgentRestoreTarget,
  getAssistantMessageOwnText,
} from '../core/inline-agent/message-anchor';

function buildMessage(ownText: string, injected?: string): HTMLElement {
  const message = document.createElement('div');
  message.className = 'ds-message';
  const host = document.createElement('div');
  host.className = 'ds-markdown';
  host.textContent = ownText;
  message.appendChild(host);
  if (injected) {
    const console_ = document.createElement('div');
    console_.className = 'dpp-agent-container';
    console_.textContent = injected;
    host.appendChild(console_);
  }
  return message;
}

describe('findAssistantMessageByContentSnippet (Issue #551 follow-up)', () => {
  const snippet = '用户要求重新绘制 Anthropic ARR 折线图，需要先获取最新数据。';

  it('anchors to the newest matching message, never an older one', () => {
    const older = buildMessage(`旧轮次：${snippet}`);
    const newer = buildMessage(`新一轮：${snippet}`);
    expect(findAssistantMessageByContentSnippet([older, newer], snippet, new Set())).toBe(newer);
  });

  it('ignores text inside injected agent consoles when matching', () => {
    // The old run's message contains the snippet only inside its injected
    // console timeline — it must not claim the new run's anchor.
    const oldWithConsole = buildMessage('旧轮次回答内容', `Step 1 ${snippet} Step 2`);
    const freshText = '我先调用工具获取最新的月度数据。';
    const fresh = buildMessage(freshText);
    const messages = [oldWithConsole, fresh];
    expect(
      findAssistantMessageByContentSnippet(messages, snippet, new Set([fresh])),
    ).toBeNull();
    expect(
      findAssistantMessageByContentSnippet(messages, freshText, new Set()),
    ).toBe(fresh);
  });

  it('skips messages already claimed via usedMessages', () => {
    const claimed = buildMessage(`旧轮次：${snippet}`);
    const fresh = buildMessage(`新一轮：${snippet}`);
    expect(
      findAssistantMessageByContentSnippet([claimed, fresh], snippet, new Set([claimed])),
    ).toBe(fresh);
  });

  it('returns null for snippets shorter than 12 normalized chars', () => {
    const message = buildMessage('短文本');
    expect(findAssistantMessageByContentSnippet([message], '短文本', new Set())).toBeNull();
  });
});

describe('getAssistantMessageOwnText', () => {
  it('excludes console, final-answer, tool-block, and autosave-note subtrees', () => {
    const message = buildMessage('消息正文');
    const host = message.querySelector('.ds-markdown')!;
    const answer = document.createElement('div');
    answer.setAttribute('data-dpp-body-text', 'true');
    answer.textContent = '最终答案区';
    const toolBlock = document.createElement('div');
    toolBlock.className = 'dpp-tool-block';
    toolBlock.textContent = '已调用工具 3 次';
    const note = document.createElement('div');
    note.className = 'dpp-agent-autosave-note';
    note.textContent = '已自动保存';
    host.append(answer, toolBlock, note);

    const ownText = getAssistantMessageOwnText(message);
    expect(ownText).toContain('消息正文');
    expect(ownText).not.toContain('最终答案区');
    expect(ownText).not.toContain('已调用工具');
    expect(ownText).not.toContain('已自动保存');
  });
});

describe('findInlineAgentRestoreTarget (Issue #551 follow-up: virtual-window-safe restore)', () => {
  // DeepSeek renders chat through a virtual list: the messages array is only
  // the currently rendered window. A restored trace whose anchor message is
  // scrolled out must stay pending — never mount onto an unrelated message
  // that happens to sit at a colliding window position.

  const oldAnchorText = '旧一轮 agent 运行所在的助手消息正文，包含 Anthropic ARR 月度增长的搜索结果。';
  const newAnchorText = '用户要的是「重新绘制一版」折线图，我先获取最新数据再渲染。';

  function buildMessageWithId(ownText: string, messageId?: string): HTMLElement {
    const message = buildMessage(ownText);
    if (messageId) message.setAttribute('data-message-id', messageId);
    return message;
  }

  it('anchors by DOM message id when the anchor message is rendered', () => {
    const other = buildMessageWithId(newAnchorText, '222');
    const anchor = buildMessageWithId(oldAnchorText, '111');
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '111', anchorContent: '' },
      [],
      [other, anchor],
      new Set(),
    )).toBe(anchor);
  });

  it('anchors by anchor content when no id matches', () => {
    const other = buildMessageWithId(newAnchorText, '222');
    const anchor = buildMessageWithId(oldAnchorText, '333');
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '111', anchorContent: oldAnchorText },
      [],
      [other, anchor],
      new Set(),
    )).toBe(anchor);
  });

  it('anchors by a persisted tool record content hint from the same message', () => {
    const other = buildMessageWithId(newAnchorText, '222');
    const anchor = buildMessageWithId(oldAnchorText, '333');
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '111', anchorContent: '' },
      ['tool record content that does not match', oldAnchorText],
      [other, anchor],
      new Set(),
    )).toBe(anchor);
  });

  it('returns null when the anchor message is scrolled out of the virtual window', () => {
    // Regression: the old run's console mounted onto the newest message
    // through a stale window index. Only the new run's message is rendered.
    const newRunMessage = buildMessageWithId(newAnchorText, '222');
    const messages = [newRunMessage];
    const used = new Set<Element>();
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '111', anchorContent: oldAnchorText },
      [oldAnchorText],
      messages,
      used,
    )).toBeNull();
    // ...while the new run's own trace still anchors correctly.
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '222', anchorContent: newAnchorText },
      [],
      messages,
      used,
    )).toBe(newRunMessage);
  });

  it('never claims a message already used by another restored trace', () => {
    const anchor = buildMessageWithId(oldAnchorText, '111');
    expect(findInlineAgentRestoreTarget(
      { anchorMessageId: '111', anchorContent: oldAnchorText },
      [],
      [anchor],
      new Set([anchor]),
    )).toBeNull();
  });
});

describe('elementHasMessageId', () => {
  it('matches direct attributes and descendant id suffixes', () => {
    const direct = document.createElement('div');
    direct.setAttribute('data-message-id', '42');
    expect(elementHasMessageId(direct, '42')).toBe(true);

    const nested = document.createElement('div');
    const child = document.createElement('div');
    child.id = 'ds-message-42';
    nested.appendChild(child);
    expect(elementHasMessageId(nested, '42')).toBe(true);
    expect(elementHasMessageId(nested, '43')).toBe(false);
  });

  it('does not match a numeric id inside a longer suffix (token boundary)', () => {
    // Looking up message id 34 must not match an unrelated element whose
    // value merely ENDS with `-34` inside a longer id (e.g. `…-234`): the
    // old bare endsWith match could anchor a console under the wrong message.
    const nested = document.createElement('div');
    const child = document.createElement('div');
    child.id = 'ds-message-234';
    nested.appendChild(child);
    expect(elementHasMessageId(nested, '34')).toBe(false);
    expect(elementHasMessageId(nested, '234')).toBe(true);

    const underscore = document.createElement('div');
    const underscored = document.createElement('div');
    underscored.setAttribute('data-id', 'msg_18');
    underscore.appendChild(underscored);
    expect(elementHasMessageId(underscore, '18')).toBe(true);
  });
});

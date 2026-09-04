import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToolsPage from '../entrypoints/sidepanel/pages/ToolsPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('Tools page host permission controls', () => {
  it('keeps the all-sites request in the sidepanel and makes denial visible', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_WEB_TOOL_SETTINGS') {
        return { web_search: true, web_fetch: true };
      }
      if (message.type === 'GET_MCP_SERVERS') return [];
      if (message.type === 'GET_PLATFORM_CAPABILITIES') {
        return {
          kind: 'browser_extension',
          name: 'WebExtension',
          capabilities: { nativeMessaging: false },
        };
      }
      throw new Error(`Unexpected runtime command: ${message.type}`);
    });
    const request = vi.fn(async () => false);
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      permissions: { request },
    });

    await render();
    await flushPromises();
    await clickButton('授权全部网站');

    expect(request).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'REQUEST_HOST_PERMISSION',
    }));
    expect(container.textContent).toContain('权限被拒绝，请重试或前往 chrome://extensions 手动添加');
  });
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(ToolsPage));
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_BOUNDARY_ERROR_CODES,
  type RuntimeMessageContext,
} from '../core/messaging/runtime-boundary';
import { requiresCurrentToolAuthorizationSubject } from '../core/messaging/tool-runtime-contracts';
import { refreshRuntimeMessageContextFromBrowserTab } from '../entrypoints/background/runtime-message-context';

const DEEPSEEK_CONTEXT: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'deepseek_content',
  senderUrl: 'https://chat.deepseek.com/',
  senderOrigin: 'https://chat.deepseek.com',
  tabId: 17,
  tabUrl: 'https://chat.deepseek.com/',
  frameId: 0,
  documentId: 'document-1',
  documentSessionId: 'document-1',
};

describe('background runtime message context refresh', () => {
  it('refreshes only messages that consume a tool authorization subject', () => {
    expect([
      'CREATE_TOOL_AUTHORIZATION',
      'CLOSE_TOOL_AUTHORIZATION',
      'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK',
      'EXECUTE_TOOL_CALL',
    ].every(requiresCurrentToolAuthorizationSubject)).toBe(true);
    expect(requiresCurrentToolAuthorizationSubject('GET_TOOL_DESCRIPTORS')).toBe(false);
  });

  it('uses the current browser-owned tab route when a content sender snapshot is stale', async () => {
    const get = vi.fn(async () => ({
      id: 17,
      url: 'https://chat.deepseek.com/a/chat/s/current-session',
    }));

    await expect(refreshRuntimeMessageContextFromBrowserTab(DEEPSEEK_CONTEXT, {
      tabs: { get },
      deepSeekOrigin: 'https://chat.deepseek.com',
    })).resolves.toMatchObject({
      tabUrl: 'https://chat.deepseek.com/a/chat/s/current-session',
      chatSessionId: 'current-session',
      documentSessionId: 'document-1',
    });
    expect(get).toHaveBeenCalledWith(17);
  });

  it('does not look up a browser tab for an extension context', async () => {
    const get = vi.fn();
    const extensionContext: RuntimeMessageContext = {
      ...DEEPSEEK_CONTEXT,
      surface: 'extension_context',
      senderUrl: 'chrome-extension://extension-id/sidepanel.html',
      senderOrigin: 'chrome-extension://extension-id',
      tabId: undefined,
      tabUrl: undefined,
      frameId: undefined,
      documentId: 'sidepanel-document-1',
      documentSessionId: 'sidepanel-document-1',
    };

    await expect(refreshRuntimeMessageContextFromBrowserTab(extensionContext, {
      tabs: { get },
      deepSeekOrigin: 'https://chat.deepseek.com',
    })).resolves.toBe(extensionContext);
    expect(get).not.toHaveBeenCalled();
  });

  it('fails closed when the receiving tab can no longer be read', async () => {
    await expect(refreshRuntimeMessageContextFromBrowserTab(DEEPSEEK_CONTEXT, {
      tabs: { get: vi.fn(async () => { throw new Error('No tab with id: 17'); }) },
      deepSeekOrigin: 'https://chat.deepseek.com',
    })).rejects.toMatchObject({
      code: RUNTIME_BOUNDARY_ERROR_CODES.unauthorizedSender,
      message: 'Runtime content sender browser tab is unavailable.',
    });
  });
});

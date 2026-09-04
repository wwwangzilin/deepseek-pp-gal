import type { ToolCall } from '../../core/types';

export const TOOL_SESSION_BINDING_TIMEOUT_MS = 5_000;
const CONTENT_NAVIGATION_EVENT = 'dpp:navigation';

interface ToolSessionBindingOptions {
  readonly readChatSessionId: () => string | null;
  readonly target?: EventTarget;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * A null grant is valid only while a new chat is awaiting its browser-owned
 * route. Never use a streamed/page session claim to complete that binding.
 */
export async function bindNewChatToolCallToBrowserSession(
  call: ToolCall,
  authorizationChatSessionId: string | null | undefined,
  options: ToolSessionBindingOptions,
): Promise<ToolCall | null> {
  if (authorizationChatSessionId !== null) return call;
  if (!call.source) return null;

  const chatSessionId = await waitForBrowserOwnedChatSession(options);
  if (!chatSessionId) return null;
  return {
    ...call,
    source: {
      ...call.source,
      chatSessionId,
    },
  };
}

export function waitForBrowserOwnedChatSession(
  options: ToolSessionBindingOptions,
): Promise<string | null> {
  const existing = options.readChatSessionId();
  if (existing) return Promise.resolve(existing);
  if (options.signal?.aborted) return Promise.resolve(null);

  const target = options.target ?? window;
  const timeoutMs = options.timeoutMs ?? TOOL_SESSION_BINDING_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (sessionId: string | null) => {
      if (settled) return;
      settled = true;
      target.removeEventListener(CONTENT_NAVIGATION_EVENT, onNavigation);
      options.signal?.removeEventListener('abort', onAbort);
      if (timer !== null) clearTimeout(timer);
      resolve(sessionId);
    };
    const onNavigation = () => {
      const sessionId = options.readChatSessionId();
      if (sessionId) finish(sessionId);
    };
    const onAbort = () => finish(null);

    target.addEventListener(CONTENT_NAVIGATION_EVENT, onNavigation);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(null), timeoutMs);
    onNavigation();
  });
}

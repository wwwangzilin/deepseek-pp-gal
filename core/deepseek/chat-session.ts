const DEEPSEEK_CHAT_SESSION_PATHNAME = /^\/(?:a\/)?chat\/s\/([^/?#]+)/;

/**
 * Reads a DeepSeek conversation identifier from a browser URL or pathname.
 * Invalid percent-encoding is rejected so every caller observes the same
 * browser-owned route identity.
 */
export function readDeepSeekChatSessionId(value: string | URL): string | null {
  const pathname = typeof value === 'string' ? readPathname(value) : value.pathname;
  const match = pathname.match(DEEPSEEK_CHAT_SESSION_PATHNAME);
  if (!match?.[1]) return null;
  try {
    const sessionId = decodeURIComponent(match[1]);
    return sessionId.trim() ? sessionId : null;
  } catch {
    return null;
  }
}

function readPathname(value: string): string {
  try {
    return new URL(value, 'https://chat.deepseek.com').pathname;
  } catch {
    return value;
  }
}

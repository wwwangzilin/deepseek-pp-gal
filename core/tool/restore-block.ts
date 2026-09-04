export interface ToolRestoreBlockIdentity {
  requestId?: string | null;
  chatSessionId?: string | null;
  parentMessageId?: number | null;
  fallbackUrl: string;
  fallbackSeed?: string | null;
}

export interface ToolRestoreBlockUrlInput {
  origin: string;
  pathname: string;
  search?: string;
  chatSessionId?: string | null;
}

export function createToolRestoreBlockId(identity: ToolRestoreBlockIdentity): string {
  if (identity.requestId) {
    return `request:${hashString(identity.requestId)}`;
  }

  if (identity.chatSessionId) {
    return `chat:${hashString(`${identity.chatSessionId}\n${identity.parentMessageId ?? ''}`)}`;
  }

  return `route:${hashString(`${identity.fallbackUrl}\n${identity.fallbackSeed ?? ''}`)}`;
}

export function createToolRestoreBlockUrl(input: ToolRestoreBlockUrlInput): string {
  if (!input.chatSessionId) {
    return `${input.origin}${input.pathname}${input.search ?? ''}`;
  }

  const prefix = input.pathname.startsWith('/chat/s/') ? '/chat/s/' : '/a/chat/s/';
  return `${input.origin}${prefix}${encodeURIComponent(input.chatSessionId)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

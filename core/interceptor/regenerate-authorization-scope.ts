import { normalizeDeepSeekMessageId } from '../deepseek/request-codec';
import type { ToolCallRestoreRecord } from '../types';

const DEFAULT_MAX_REGENERATE_AUTHORIZATION_SCOPES = 64;
const DEFAULT_MAX_REGENERATE_PROMPT_CHARS = 64_000;
const MAX_REGENERATE_DESCRIPTOR_IDS = 512;
export const REGENERATE_AUTHORIZATION_METADATA_KEY = 'regenerateAuthorization';

export interface RegeneratePromptOptionsSnapshot {
  modelType: string | null;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  refFileIds: string[];
}

export interface RegenerateAuthorizationScopeInput {
  chatSessionId: string | null | undefined;
  assistantMessageId: number | string | null | undefined;
  descriptorIds: readonly string[];
  originalPrompt: string;
  agentTaskPrompt: string;
  promptOptions: RegeneratePromptOptionsSnapshot;
  activeLocalSkillDir?: string;
}

export interface RegenerateAuthorizationScope {
  chatSessionId: string;
  assistantMessageId: number;
  descriptorIds: string[];
  originalPrompt: string;
  agentTaskPrompt: string;
  promptOptions: RegeneratePromptOptionsSnapshot;
  activeLocalSkillDir?: string;
}

export interface PersistedRegenerateAuthorizationEvidence {
  descriptorIds: string[];
  promptOptions?: RegeneratePromptOptionsSnapshot;
  activeLocalSkillDir?: string;
}

export interface RegenerateAuthorizationScopeStore {
  remember(input: RegenerateAuthorizationScopeInput): boolean;
  resolve(chatSessionId: string, childMessageId: number | string): RegenerateAuthorizationScope | null;
  clear(): void;
  readonly size: number;
}

export function createRegenerateAuthorizationScopeStore(options: {
  maxEntries?: number;
  maxPromptChars?: number;
} = {}): RegenerateAuthorizationScopeStore {
  const maxEntries = normalizePositiveLimit(
    options.maxEntries,
    DEFAULT_MAX_REGENERATE_AUTHORIZATION_SCOPES,
  );
  const maxPromptChars = normalizePositiveLimit(
    options.maxPromptChars,
    DEFAULT_MAX_REGENERATE_PROMPT_CHARS,
  );
  const scopes = new Map<string, RegenerateAuthorizationScope>();

  return {
    remember(input) {
      const scope = normalizeScope(input, maxPromptChars);
      if (!scope) return false;
      const key = createScopeKey(scope.chatSessionId, scope.assistantMessageId);
      scopes.delete(key);
      scopes.set(key, scope);
      while (scopes.size > maxEntries) {
        const oldestKey = scopes.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        scopes.delete(oldestKey);
      }
      return true;
    },
    resolve(chatSessionId, childMessageId) {
      const normalizedSessionId = normalizeChatSessionId(chatSessionId);
      const normalizedMessageId = normalizeDeepSeekMessageId(childMessageId);
      if (!normalizedSessionId || normalizedMessageId === null) return null;
      const key = createScopeKey(normalizedSessionId, normalizedMessageId);
      const scope = scopes.get(key);
      if (!scope) return null;
      // Keep frequently regenerated branches available while the bounded store
      // evicts unrelated older responses.
      scopes.delete(key);
      scopes.set(key, scope);
      return cloneScope(scope);
    },
    clear() {
      scopes.clear();
    },
    get size() {
      return scopes.size;
    },
  };
}

export function createPersistedRegenerateAuthorizationMetadata(
  scope: Pick<RegenerateAuthorizationScope, 'descriptorIds' | 'promptOptions' | 'activeLocalSkillDir'>,
): Record<string, unknown> {
  return {
    descriptorIds: [...scope.descriptorIds],
    promptOptions: clonePromptOptions(scope.promptOptions),
    ...(scope.activeLocalSkillDir ? { activeLocalSkillDir: scope.activeLocalSkillDir } : {}),
  };
}

/**
 * Recover the narrowest extension-owned authorization evidence for an older
 * response. New records carry the exact descriptor scope captured at response
 * completion. Records written by older releases fall back to only the
 * descriptors that the extension actually EXECUTED for that exact assistant
 * message (executions with a non-ok result — rejected, interrupted, or
 * never-authorized calls — are excluded); they never expand to the current
 * full catalog.
 */
export function resolvePersistedRegenerateAuthorizationEvidence(
  records: readonly ToolCallRestoreRecord[],
  chatSessionId: string,
  childMessageId: number | string,
): PersistedRegenerateAuthorizationEvidence | null {
  const normalizedSessionId = normalizeChatSessionId(chatSessionId);
  const normalizedMessageId = normalizeDeepSeekMessageId(childMessageId);
  if (!normalizedSessionId || normalizedMessageId === null) return null;

  const matching = records.filter((record) =>
    readRecordChatSessionId(record) === normalizedSessionId
    && readRecordAssistantMessageId(record) === normalizedMessageId
  );
  if (matching.length === 0) return null;

  for (let index = matching.length - 1; index >= 0; index -= 1) {
    const explicit = decodePersistedMetadata(matching[index].metadata?.[REGENERATE_AUTHORIZATION_METADATA_KEY]);
    if (explicit) return explicit;
  }

  const descriptorIds = normalizeDescriptorIds(
    matching.flatMap((record) =>
      (record.executions ?? [])
        // Only successfully executed calls are evidence of prior
        // authorization. Rejected (tool_not_authorized) and interrupted
        // executions carry a descriptorId too but were never authorized, so
        // replaying them would expand the regenerate grant beyond what the
        // original run actually executed.
        .filter((execution) => execution.result?.ok === true)
        .map((execution) => execution.descriptorId ?? '')
    ),
  );
  return descriptorIds && descriptorIds.length > 0 ? { descriptorIds } : null;
}

function normalizeScope(
  input: RegenerateAuthorizationScopeInput,
  maxPromptChars: number,
): RegenerateAuthorizationScope | null {
  const chatSessionId = normalizeChatSessionId(input.chatSessionId);
  const assistantMessageId = normalizeDeepSeekMessageId(input.assistantMessageId);
  if (!chatSessionId || assistantMessageId === null) return null;

  const descriptorIds = normalizeDescriptorIds(input.descriptorIds);
  if (!descriptorIds) return null;
  if (typeof input.originalPrompt !== 'string' || typeof input.agentTaskPrompt !== 'string') return null;
  if (
    input.originalPrompt.length > maxPromptChars
    || input.agentTaskPrompt.length > maxPromptChars
    || !isPromptOptionsSnapshot(input.promptOptions)
  ) return null;

  const activeLocalSkillDir = typeof input.activeLocalSkillDir === 'string' && input.activeLocalSkillDir.trim()
    ? input.activeLocalSkillDir
    : undefined;
  return {
    chatSessionId,
    assistantMessageId,
    descriptorIds,
    originalPrompt: input.originalPrompt,
    agentTaskPrompt: input.agentTaskPrompt,
    promptOptions: clonePromptOptions(input.promptOptions),
    ...(activeLocalSkillDir ? { activeLocalSkillDir } : {}),
  };
}

function decodePersistedMetadata(value: unknown): PersistedRegenerateAuthorizationEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.descriptorIds)) return null;
  const descriptorIds = normalizeDescriptorIds(record.descriptorIds);
  if (!descriptorIds || descriptorIds.length === 0) return null;

  const promptOptions = record.promptOptions === undefined
    ? undefined
    : isPromptOptionsSnapshot(record.promptOptions as RegeneratePromptOptionsSnapshot)
      ? clonePromptOptions(record.promptOptions as RegeneratePromptOptionsSnapshot)
      : null;
  if (promptOptions === null) return null;

  const activeLocalSkillDir = typeof record.activeLocalSkillDir === 'string' && record.activeLocalSkillDir.trim()
    ? record.activeLocalSkillDir
    : undefined;
  return {
    descriptorIds,
    ...(promptOptions ? { promptOptions } : {}),
    ...(activeLocalSkillDir ? { activeLocalSkillDir } : {}),
  };
}

function normalizeDescriptorIds(value: readonly unknown[]): string[] | null {
  const ids = [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
  return ids.length <= MAX_REGENERATE_DESCRIPTOR_IDS ? ids : null;
}

function readRecordChatSessionId(record: ToolCallRestoreRecord): string | null {
  const metadataSessionId = normalizeChatSessionId(
    typeof record.metadata?.chatSessionId === 'string' ? record.metadata.chatSessionId : null,
  );
  if (metadataSessionId) return metadataSessionId;
  if (!record.url) return null;
  try {
    const parsed = new URL(record.url, 'https://chat.deepseek.com');
    const match = parsed.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function readRecordAssistantMessageId(record: ToolCallRestoreRecord): number | null {
  return normalizeDeepSeekMessageId(
    record.metadata?.assistantMessageId ?? record.metadata?.messageId,
  );
}

function isPromptOptionsSnapshot(value: RegeneratePromptOptionsSnapshot): boolean {
  return Boolean(
    value
    && (value.modelType === null || typeof value.modelType === 'string')
    && typeof value.searchEnabled === 'boolean'
    && typeof value.thinkingEnabled === 'boolean'
    && Array.isArray(value.refFileIds)
    && value.refFileIds.every((id) => typeof id === 'string'),
  );
}

function cloneScope(scope: RegenerateAuthorizationScope): RegenerateAuthorizationScope {
  return {
    ...scope,
    descriptorIds: [...scope.descriptorIds],
    promptOptions: clonePromptOptions(scope.promptOptions),
  };
}

function clonePromptOptions(
  promptOptions: RegeneratePromptOptionsSnapshot,
): RegeneratePromptOptionsSnapshot {
  return {
    modelType: promptOptions.modelType,
    searchEnabled: promptOptions.searchEnabled,
    thinkingEnabled: promptOptions.thinkingEnabled,
    refFileIds: [...promptOptions.refFileIds],
  };
}

function normalizeChatSessionId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createScopeKey(chatSessionId: string, assistantMessageId: number): string {
  return `${chatSessionId}\0${assistantMessageId}`;
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

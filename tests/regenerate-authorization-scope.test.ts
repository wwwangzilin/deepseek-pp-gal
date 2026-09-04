import { describe, expect, it } from 'vitest';
import type { ToolCallRestoreRecord } from '../core/types';
import {
  REGENERATE_AUTHORIZATION_METADATA_KEY,
  createPersistedRegenerateAuthorizationMetadata,
  createRegenerateAuthorizationScopeStore,
  resolvePersistedRegenerateAuthorizationEvidence,
} from '../core/interceptor/regenerate-authorization-scope';

const PROMPT_OPTIONS = {
  modelType: 'expert',
  searchEnabled: false,
  thinkingEnabled: true,
  refFileIds: ['file-1'],
};

describe('regenerate authorization scope', () => {
  it('resolves only the exact receiver-owned session and assistant message pair', () => {
    const store = createRegenerateAuthorizationScopeStore();
    expect(store.remember({
      chatSessionId: ' session-1 ',
      assistantMessageId: 18,
      descriptorIds: ['mcp:one', 'mcp:one', 'local:two'],
      originalPrompt: 'visible prompt',
      agentTaskPrompt: 'agent task',
      promptOptions: PROMPT_OPTIONS,
      activeLocalSkillDir: '/trusted/skill',
    })).toBe(true);

    expect(store.resolve('session-1', 18)).toEqual({
      chatSessionId: 'session-1',
      assistantMessageId: 18,
      descriptorIds: ['mcp:one', 'local:two'],
      originalPrompt: 'visible prompt',
      agentTaskPrompt: 'agent task',
      promptOptions: PROMPT_OPTIONS,
      activeLocalSkillDir: '/trusted/skill',
    });
    expect(store.resolve('session-2', 18)).toBeNull();
    expect(store.resolve('session-1', 19)).toBeNull();
  });

  it('returns isolated snapshots instead of mutable authority references', () => {
    const store = createRegenerateAuthorizationScopeStore();
    store.remember({
      chatSessionId: 'session-1',
      assistantMessageId: 18,
      descriptorIds: ['mcp:one'],
      originalPrompt: 'visible prompt',
      agentTaskPrompt: 'agent task',
      promptOptions: PROMPT_OPTIONS,
    });

    const first = store.resolve('session-1', 18)!;
    first.descriptorIds.push('mcp:injected');
    first.promptOptions.refFileIds.push('file-injected');

    expect(store.resolve('session-1', 18)).toEqual(expect.objectContaining({
      descriptorIds: ['mcp:one'],
      promptOptions: expect.objectContaining({ refFileIds: ['file-1'] }),
    }));
  });

  it('evicts older responses at the configured bound and rejects malformed scopes', () => {
    const store = createRegenerateAuthorizationScopeStore({ maxEntries: 2, maxPromptChars: 16 });
    const remember = (assistantMessageId: number, prompt = 'prompt') => store.remember({
      chatSessionId: 'session-1',
      assistantMessageId,
      descriptorIds: ['mcp:one'],
      originalPrompt: prompt,
      agentTaskPrompt: prompt,
      promptOptions: PROMPT_OPTIONS,
    });

    expect(remember(1)).toBe(true);
    expect(remember(2)).toBe(true);
    expect(remember(3)).toBe(true);
    expect(store.size).toBe(2);
    expect(store.resolve('session-1', 1)).toBeNull();
    expect(store.resolve('session-1', 2)).not.toBeNull();
    expect(store.resolve('session-1', 3)).not.toBeNull();

    expect(store.remember({
      chatSessionId: '',
      assistantMessageId: 4,
      descriptorIds: [],
      originalPrompt: '',
      agentTaskPrompt: '',
      promptOptions: PROMPT_OPTIONS,
    })).toBe(false);
    expect(remember(4, 'prompt that is too long')).toBe(false);
  });

  it('prefers an exact persisted descriptor scope over legacy execution evidence', () => {
    const metadata = createPersistedRegenerateAuthorizationMetadata({
      descriptorIds: ['mcp:one', 'local:two'],
      promptOptions: PROMPT_OPTIONS,
      activeLocalSkillDir: '/trusted/skill',
    });
    const records = [
      createPersistedBlock({
        id: 'legacy',
        descriptorIds: ['mcp:legacy'],
      }),
      createPersistedBlock({
        id: 'exact',
        descriptorIds: ['mcp:executed-only'],
        metadata: { [REGENERATE_AUTHORIZATION_METADATA_KEY]: metadata },
      }),
    ];

    const evidence = resolvePersistedRegenerateAuthorizationEvidence(records, 'session-1', 18);

    expect(evidence).toEqual({
      descriptorIds: ['mcp:one', 'local:two'],
      promptOptions: PROMPT_OPTIONS,
      activeLocalSkillDir: '/trusted/skill',
    });
    evidence!.descriptorIds.push('mcp:mutated');
    evidence!.promptOptions!.refFileIds.push('file-mutated');
    expect(metadata).toEqual(expect.objectContaining({
      descriptorIds: ['mcp:one', 'local:two'],
      promptOptions: expect.objectContaining({ refFileIds: ['file-1'] }),
    }));
  });

  it('recovers only previously executed descriptors for an exact legacy response', () => {
    const records = [
      createPersistedBlock({ id: 'first', descriptorIds: ['mcp:one', 'mcp:one'] }),
      createPersistedBlock({ id: 'second', descriptorIds: ['local:two'] }),
      createPersistedBlock({
        id: 'other-message',
        assistantMessageId: 19,
        descriptorIds: ['mcp:not-authorized'],
      }),
      createPersistedBlock({
        id: 'other-session',
        chatSessionId: 'session-2',
        descriptorIds: ['mcp:not-authorized'],
      }),
    ];

    expect(resolvePersistedRegenerateAuthorizationEvidence(records, 'session-1', 18)).toEqual({
      descriptorIds: ['mcp:one', 'local:two'],
    });
    expect(resolvePersistedRegenerateAuthorizationEvidence(records, 'session-1', 20)).toBeNull();
  });

  it('excludes rejected and interrupted executions from the legacy fallback', () => {
    // Rejected (tool_not_authorized) and interrupted executions carry a
    // descriptorId in the persisted record, but they were never authorized;
    // the regenerate replay scope must only contain successfully executed
    // descriptors.
    const records = [
      createPersistedBlock({
        id: 'with-rejections',
        descriptorIds: [],
        executions: [
          { name: 'mcp:one', descriptorId: 'mcp:one', ok: true },
          { name: 'mcp:rejected', descriptorId: 'mcp:rejected', ok: false },
          { name: 'local:interrupted', descriptorId: 'local:interrupted', ok: false },
        ],
      }),
    ];

    expect(resolvePersistedRegenerateAuthorizationEvidence(records, 'session-1', 18)).toEqual({
      descriptorIds: ['mcp:one'],
    });
  });
});

function createPersistedBlock(options: {
  id: string;
  chatSessionId?: string;
  assistantMessageId?: number;
  descriptorIds: string[];
  executions?: Array<{ name: string; descriptorId: string; ok: boolean }>;
  metadata?: Record<string, unknown>;
}): ToolCallRestoreRecord {
  const chatSessionId = options.chatSessionId ?? 'session-1';
  const assistantMessageId = options.assistantMessageId ?? 18;
  return {
    id: options.id,
    source: 'storage',
    url: `https://chat.deepseek.com/a/chat/s/${chatSessionId}`,
    createdAt: 1,
    executions: options.executions?.map((execution) => ({
      name: execution.name,
      descriptorId: execution.descriptorId,
      result: { ok: execution.ok, summary: 'done' },
    })) ?? options.descriptorIds.map((descriptorId) => ({
      name: descriptorId,
      descriptorId,
      result: { ok: true, summary: 'done' },
    })),
    metadata: {
      chatSessionId,
      assistantMessageId,
      ...options.metadata,
    },
  };
}

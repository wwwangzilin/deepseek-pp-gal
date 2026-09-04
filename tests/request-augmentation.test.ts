import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createBrowserControlToolDescriptors } from '../core/browser-control/tool';
import {
  augmentRequestBody,
  decodeAugmentableDeepSeekRequest,
  decodeAugmentableDeepSeekRequestBody,
  decodeDeepSeekRegenerateRequestBody,
  decodeDeepSeekRequestBody,
} from '../core/interceptor/request-augmentation';
import { buildPromptAugmentation, extractVisibleUserPrompt } from '../core/prompt';

describe('augmentRequestBody', () => {
  it('strictly decodes one plain-object request with a non-empty string prompt', () => {
    const body = decodeDeepSeekRequestBody(JSON.stringify({
      prompt: 'hello',
      future_sibling: { keep: true },
    }));

    expect(body).toEqual({
      prompt: 'hello',
      future_sibling: { keep: true },
    });
    expect(() => decodeDeepSeekRequestBody('{bad json}')).toThrow('valid JSON');
    expect(() => decodeDeepSeekRequestBody('null')).toThrow('plain object');
    expect(() => decodeDeepSeekRequestBody('[]')).toThrow('plain object');
    expect(() => decodeDeepSeekRequestBody(JSON.stringify({ prompt: 1 }))).toThrow('non-empty string');
    expect(() => decodeDeepSeekRequestBody(JSON.stringify({ prompt: '' }))).toThrow('non-empty string');
  });

  it('treats request shapes that cannot be augmented as explicit passthroughs', () => {
    expect(decodeAugmentableDeepSeekRequestBody(JSON.stringify({
      prompt: 'hello',
      future_sibling: true,
    }))).toEqual({ prompt: 'hello', future_sibling: true });
    expect(decodeAugmentableDeepSeekRequestBody('{bad json}')).toBeNull();
    expect(decodeAugmentableDeepSeekRequestBody(JSON.stringify({ prompt: '' }))).toBeNull();
    expect(decodeAugmentableDeepSeekRequestBody(JSON.stringify({ prompt: 1 }))).toBeNull();
  });

  it('decodes the native promptless regenerate route without inventing a prompt', () => {
    const rawBody = JSON.stringify({
      chat_session_id: ' session-1 ',
      child_message_id: 18,
      search_enabled: false,
      thinking_enabled: true,
      user_options: null,
      future_sibling: { keep: true },
    });

    expect(decodeDeepSeekRegenerateRequestBody(rawBody)).toEqual({
      chat_session_id: 'session-1',
      child_message_id: 18,
      search_enabled: false,
      thinking_enabled: true,
      user_options: null,
      future_sibling: { keep: true },
    });
    expect(decodeAugmentableDeepSeekRequest('regenerate', rawBody)).toEqual({
      route: 'regenerate',
      body: expect.objectContaining({
        chat_session_id: 'session-1',
        child_message_id: 18,
      }),
    });
    expect(decodeAugmentableDeepSeekRequest('completion', rawBody)).toBeNull();
    expect(decodeAugmentableDeepSeekRequest('regenerate', JSON.stringify({
      chat_session_id: 'session-1',
    }))).toBeNull();
    expect(decodeAugmentableDeepSeekRequest('regenerate', JSON.stringify({
      child_message_id: 18,
    }))).toBeNull();
  });

  it('does not hide augmentation failures after the request body has decoded', () => {
    const state = {
      memories: [],
      get skills(): never {
        throw new Error('skill state unavailable');
      },
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
    };

    expect(() => augmentRequestBody('{"prompt":"/writer"}', state))
      .toThrow('skill state unavailable');
  });

  it('applies expert mode and advances request message count without exposing state to main-world', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'hello',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    expect(result?.messageCount).toBe(1);
    expect(JSON.parse(result?.body ?? '{}').model_type).toBe('expert');
    expect(result?.usedMemoryIds).toEqual([]);
  });

  it('applies vision mode while preserving official file references', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'describe this image',
      parent_message_id: 12,
      thinking_enabled: false,
      ref_file_ids: ['file-image-1'],
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'vision',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 2,
    });

    const body = JSON.parse(result?.body ?? '{}');
    expect(result?.messageCount).toBe(3);
    expect(body.model_type).toBe('vision');
    expect(body.ref_file_ids).toEqual(['file-image-1']);
  });

  it('emits English prompt scaffolding while keeping XML tool tags stable', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'en',
    });

    expect(result.augmented).toContain('## Role');
    expect(result.augmented).toContain('(No memories yet)');
    expect(result.augmented).toContain('## Web Search Rules');
    expect(result.augmented).toContain('Available tool tag names: memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).toContain('</memory_save>');
    expect(result.augmented).toContain('Invalid formats: <invoke name="memory_save">...</invoke>, <tool_call>...</tool_call>');
    expect(result.augmented).not.toContain('## 角色');
  });

  it('retires artifact tools from the model-facing prompt while keeping execution descriptors', () => {
    // Issue (drop plugin artifact extension): the model must never see
    // artifact_create / artifact_bundle_create in its Available Tools, or it
    // keeps delivering files as artifact XML that no layer can render. The
    // retirement filters the MODEL-FACING projection only — the descriptors
    // themselves still exist for parsing/executing historical and residual
    // calls.
    const withArtifacts = [
      ...DEFAULT_TOOL_DESCRIPTORS,
      ...createArtifactToolDescriptors('en'),
    ];
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'create a report',
      parent_message_id: null,
      thinking_enabled: false,
      search_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: withArtifacts,
      messageCount: 0,
    });

    const augmented = JSON.parse(result?.body ?? '{}').prompt as string;
    expect(augmented).not.toContain('artifact_create');
    expect(augmented).not.toContain('artifact_bundle_create');
    expect(augmented).not.toContain('Create downloadable file');
    expect(augmented).toContain('memory_save');
  });

  it('uses locale-aware default tool descriptors when none are provided', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      locale: 'en',
    });

    expect(result.augmented).toContain('Title: Save memory');
    expect(result.augmented).toContain('Description: Save a new long-term memory');
    expect(result.augmented).toContain('Parameters JSON Schema: {"type":"object"');
    expect(result.augmented).not.toContain('Title: 保存记忆');
    expect(result.augmented).not.toContain('Description: 保存一条新的长期记忆');
  });

  it('keeps project context after base system scaffolding and before web-search guidance', () => {
    const result = buildPromptAugmentation('where is the Android entry point?', {
      memories: [],
      presetContent: 'You are a repo-aware assistant.',
      projectContext: '## Project Context\nProject: DeepSeek++\n--- android/MainActivity.kt:1-2 ---',
      locale: 'en',
    });

    const presetIndex = result.augmented.indexOf('You are a repo-aware assistant.');
    const roleIndex = result.augmented.indexOf('## Role');
    const projectIndex = result.augmented.indexOf('## Project Context');
    const webSearchIndex = result.augmented.indexOf('## Web Search Rules');
    const visibleUserIndex = result.augmented.indexOf('where is the Android entry point?');

    expect(presetIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(presetIndex);
    expect(projectIndex).toBeGreaterThan(roleIndex);
    expect(webSearchIndex).toBeGreaterThan(projectIndex);
    expect(visibleUserIndex).toBeGreaterThan(webSearchIndex);
  });

  it('keeps Chinese prompt scaffolding available under zh-CN', () => {
    const result = buildPromptAugmentation('搜索 DeepSeek 新闻', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'zh-CN',
    });

    expect(result.augmented).toContain('## 角色');
    expect(result.augmented).toContain('(暂无记忆)');
    expect(result.augmented).toContain('## 网络搜索规则');
    expect(result.augmented).toContain('可用工具标签名：memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).not.toContain('## Role');
  });

  it('honors prompt controls for memory, system prompt, and forced language', () => {
    const withoutMemory = buildPromptAugmentation('remember nothing here', {
      memories: [{
        id: 1,
        syncId: 'sync-1',
        scope: 'global',
        type: 'reference',
        name: 'Hidden memory',
        content: 'Do not include me',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      memoryEnabled: false,
      locale: 'en',
    });
    expect(withoutMemory.usedMemoryIds).toEqual([]);
    expect(withoutMemory.augmented).toContain('(Memory injection disabled for this request)');
    expect(withoutMemory.augmented).not.toContain('Do not include me');

    const withoutSystemPrompt = buildPromptAugmentation('plain prompt', {
      memories: [],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(withoutSystemPrompt.renderedToolCount).toBe(0);
    expect(withoutSystemPrompt.augmented).not.toContain('## Role');
    expect(withoutSystemPrompt.augmented).toContain('plain prompt');

    const memoryOnly = buildPromptAugmentation('remember durable facts', {
      memories: [{
        id: 2,
        syncId: 'sync-2',
        scope: 'global',
        type: 'reference',
        name: 'Durable memory',
        content: 'Inject me without the full system prompt',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(memoryOnly.usedMemoryIds).toEqual([2]);
    expect(memoryOnly.augmented).toContain('## Existing Memories');
    expect(memoryOnly.augmented).toContain('Inject me without the full system prompt');
    expect(memoryOnly.augmented).not.toContain('## Role');

    const forcedLanguage = buildPromptAugmentation('reply', {
      memories: [],
      forceResponseLanguage: 'en',
      locale: 'zh-CN',
    });
    expect(forcedLanguage.augmented).toContain('## 回复语言');
    expect(forcedLanguage.augmented).toContain('请使用英文回复。');
  });

  it('localizes skill user-input wrapper without mutating the user input', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer Draft about {raw_user_value}',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Write clearly.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('The following is the user input for this turn');
    expect(body.prompt).toContain('Draft about {raw_user_value}');
    expect(extractVisibleUserPrompt(body.prompt ?? ''))
      .toBe('/writer Draft about {raw_user_value}');
  });

  it('keeps a no-argument Skill command as the visible prompt', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Private writer instructions.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('Private writer instructions.');
    expect(extractVisibleUserPrompt(body.prompt ?? '')).toBe('/writer');
  });

  it('injects a local index Skill into the system context rather than the visible prompt', () => {
    const skillDir = '/skills/github-personal-manager';
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/demo',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'demo',
        description: 'Local demo skill used to verify system-context injection.',
        instructions: '# Local Skill: demo\nIndex form: true\n## Activation Notice\nRead SKILL.md before acting.\n',
        memoryEnabled: false,
        remote: {
          provider: 'local',
          sourceId: 'local-demo',
          path: skillDir,
          originalName: 'demo',
          importedAt: 0,
          updatedAt: 0,
          includedFiles: [],
          omittedFiles: [],
          warnings: [],
          localDirectory: skillDir,
        },
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'zh-CN',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    // 本地索引 Skill 的 localDirectory 必须回传，供 content.ts 钉死 cwd。
    expect(result?.activeLocalSkillDir).toBe(skillDir);
    // 索引 + 激活指令应进入系统上下文（如同 ## Tools 段），而非可见用户输入。
    expect(body.prompt).toContain('## 本地 Skill 激活（Local Skill Activated）');
    expect(body.prompt).toContain('local_file_read');
    // 真实用户 query 仍为可见用户输入；索引不再占据可见用户输入位（修复 Bug ② framing 倒置）。
    expect(extractVisibleUserPrompt(body.prompt ?? '')).toBe('/demo');
  });

  it('injects only global memories plus memories from the current project', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'remember the project rule',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [
        memory(1, 'global', undefined, 'Global memory', 'Always be concise.'),
        memory(2, 'project', 'project-1', 'Project memory', 'Use project glossary.'),
        memory(3, 'project', 'project-2', 'Other project memory', 'Do not include me.'),
      ],
      skills: [],
      activePreset: null,
      projectId: 'project-1',
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('Always be concise.');
    expect(body.prompt).toContain('[project reference] Project memory');
    expect(body.prompt).not.toContain('Do not include me.');
  });
});

function memory(
  id: number,
  scope: 'global' | 'project',
  projectId: string | undefined,
  name: string,
  content: string,
) {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    type: 'reference' as const,
    name,
    content,
    description: '',
    tags: [],
    pinned: true,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}

describe('page-native search projection', () => {
  it('keeps web_search schema and guidance when native search is disabled', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'search latest DeepSeek news',
      parent_message_id: null,
      thinking_enabled: false,
      search_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
      locale: 'en',
    });

    const prompt = JSON.parse(result?.body ?? '{}').prompt as string;
    expect(prompt).toContain('### Tool web_search');
    expect(prompt).toContain('## Web Search Rules');
    expect(prompt).toContain('### Tool memory_save');
    expect(JSON.parse(result?.body ?? '{}').search_enabled).toBe(false);
  });

  it('drops both local web tool schemas and guidance when native search is enabled', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'search latest DeepSeek news',
      parent_message_id: null,
      thinking_enabled: false,
      search_enabled: true,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: [
        ...DEFAULT_TOOL_DESCRIPTORS,
        ...createBrowserControlToolDescriptors('en'),
      ],
      messageCount: 0,
      locale: 'en',
    });

    const prompt = JSON.parse(result?.body ?? '{}').prompt as string;
    expect(prompt).not.toContain('### Tool web_search');
    expect(prompt).not.toContain('## Web Search Rules');
    expect(prompt).not.toContain('### Tool web_fetch');
    expect(prompt).not.toContain('### Tool browser_navigate');
    expect(prompt).toContain('### Tool memory_save');
    expect(JSON.parse(result?.body ?? '{}').search_enabled).toBe(true);
  });

  it('applies the same projection to Skill-command requests', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer Search this topic',
      parent_message_id: null,
      thinking_enabled: false,
      search_enabled: true,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Write a report using web evidence.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [
        ...DEFAULT_TOOL_DESCRIPTORS,
        ...createBrowserControlToolDescriptors('en'),
      ],
      messageCount: 0,
      locale: 'en',
    });

    const prompt = JSON.parse(result?.body ?? '{}').prompt as string;
    expect(prompt).not.toContain('### Tool web_search');
    expect(prompt).not.toContain('## Web Search Rules');
    expect(prompt).not.toContain('### Tool web_fetch');
    expect(prompt).not.toContain('### Tool browser_navigate');
    expect(prompt).toContain('### Tool memory_save');
  });

  it('keeps a hypothetical MCP web_search descriptor under native search', () => {
    const mcpDescriptor = {
      ...DEFAULT_TOOL_DESCRIPTORS.find((descriptor) => descriptor.name === 'web_search')!,
      id: 'mcp:browser-tools:web_search',
      invocationName: 'browser_tools_web_search',
      provider: {
        kind: 'mcp' as const,
        id: 'browser-tools',
        displayName: 'Browser Tools',
        transport: 'streamable_http' as const,
      },
    };
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'search latest DeepSeek news',
      parent_message_id: null,
      thinking_enabled: false,
      search_enabled: true,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: null,
      toolDescriptors: [mcpDescriptor],
      messageCount: 0,
      locale: 'en',
    });

    const prompt = JSON.parse(result?.body ?? '{}').prompt as string;
    expect(prompt).toContain('### Tool web_search');
    expect(prompt).toContain('Accepted tag names: browser_tools_web_search, web_search');
    expect(prompt).toContain('## Web Search Rules');
  });
});

// T3 本地索引 Skill 激活分支集成测试（走已导出的 augmentRequestBody 真实路径）。
// 覆盖：
//   1) 隐式分支：用户输入触发本地索引 Skill 隐式打分激活，注入「索引指令 + D4 边界」。
//   2) 显式 /skillname 命中本地索引 Skill 同样走 composeLocalSkillPrompt（索引指令 + D4 边界）。
//   3) 索引形态检测：isLocalIndexInstructions 区分「索引导入」与「旧版固化快照」。
//   4) 隔离保证：旧快照（无标记）/ builtin / github 来源不被隐式打分波及，行为不变。
//
// 环境复用 request-augmentation.test.ts：toolDescriptors: [] / memories: [] / locale: 'en'，无外部依赖、无 mock。

import { describe, expect, it } from 'vitest';
import { isLocalIndexInstructions, LOCAL_INDEX_MARKER } from '../core/skill/local-importer';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import type { Skill } from '../core/types';

const LOCAL_INDEX_INSTRUCTIONS = [
  '# Local Skill: demo',
  '',
  '## DeepSeek++ Import Metadata',
  '',
  `- ${LOCAL_INDEX_MARKER}`,
  '- Skill directory path: /skills/demo',
  '',
  '## Activation Notice',
  '',
  '- Read the Skill definition file with the local file tool: /skills/demo/SKILL.md',
  '',
  '## Local Execution Boundary',
  '',
  '- Run commands with cwd set to the Skill directory path: /skills/demo',
].join('\n');

const LEGACY_SNAPSHOT_INSTRUCTIONS = [
  '# Local Skill: legacy',
  '',
  'This is the old固化 snapshot body (no index marker).',
].join('\n');

function localIndexSkill(): Skill {
  return {
    name: 'demo',
    instructions: LOCAL_INDEX_INSTRUCTIONS,
    memoryEnabled: false,
    source: 'remote',
    description: '适用场景：生成周报、日报、总结',
    remote: {
      provider: 'local',
      localDirectory: '/skills/demo',
      localRootPath: '/skills/demo',
    },
  } as unknown as Skill;
}

function legacyLocalSkill(): Skill {
  return {
    name: 'legacy',
    instructions: LEGACY_SNAPSHOT_INSTRUCTIONS,
    memoryEnabled: false,
    source: 'remote',
    description: '适用场景：生成周报',
    remote: {
      provider: 'local',
      localDirectory: '/skills/legacy',
      localRootPath: '/skills/legacy',
    },
  } as unknown as Skill;
}

function builtinSkill(): Skill {
  return {
    name: 'writer',
    instructions: 'You are a writing assistant.',
    memoryEnabled: false,
    source: 'builtin',
    description: '适用场景：生成周报',
  } as unknown as Skill;
}

function githubSkill(): Skill {
  return {
    name: 'gh',
    instructions: 'GitHub skill body.',
    memoryEnabled: false,
    source: 'github',
    description: 'GitHub 集成',
    remote: { provider: 'github' },
  } as unknown as Skill;
}

describe('isLocalIndexInstructions（索引形态检测）', () => {
  it('含索引标记 → true', () => {
    expect(isLocalIndexInstructions(LOCAL_INDEX_INSTRUCTIONS)).toBe(true);
  });

  it('旧快照无标记 → false', () => {
    expect(isLocalIndexInstructions(LEGACY_SNAPSHOT_INSTRUCTIONS)).toBe(false);
  });

  it('undefined / 空 → false', () => {
    expect(isLocalIndexInstructions(undefined)).toBe(false);
    expect(isLocalIndexInstructions('')).toBe(false);
  });
});

describe('augmentRequestBody 本地索引 Skill 激活分支', () => {
  it('隐式分支：用户输入打分命中本地索引 Skill → 注入索引指令 + D4 边界', () => {
    // 注意：打分器复用 capability-projection 的分词器（中文整句成单 token、子串匹配），
    // 故查询须为 Skill 描述/场景中的子串（此处用「周报」）。
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [localIndexSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result).not.toBeNull();
    // agentTaskPrompt 必须是「索引指令 + D4 边界」，而非原始用户输入。
    expect(result!.agentTaskPrompt).toContain(LOCAL_INDEX_MARKER);
    expect(result!.agentTaskPrompt).toContain('## Local Execution Boundary');
    expect(result!.agentTaskPrompt).toContain('/skills/demo');
    expect(result!.agentTaskPrompt).not.toBe('周报');
    // 最终请求体同样包含注入内容。
    const bodyPrompt = JSON.parse(result!.body).prompt as string;
    expect(bodyPrompt).toContain(LOCAL_INDEX_MARKER);
    expect(bodyPrompt).toContain('## Local Execution Boundary');
  });

  it('显式 /demo 命中本地索引 Skill → 同样注入 D4 边界', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/demo 写本周周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [localIndexSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result).not.toBeNull();
    expect(result!.agentTaskPrompt).toContain('## Local Execution Boundary');
    expect(result!.agentTaskPrompt).toContain(LOCAL_INDEX_MARKER);
  });

  it('旧快照（无索引标记）不被隐式打分激活 → 透传原始输入', () => {
    const original = '帮我生成本周周报';
    const result = augmentRequestBody(JSON.stringify({
      prompt: original,
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [legacyLocalSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result!.agentTaskPrompt).toBe(original);
  });

  it('builtin 来源不被隐式打分波及 → 透传原始输入', () => {
    const original = '帮我生成本周周报';
    const result = augmentRequestBody(JSON.stringify({
      prompt: original,
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [builtinSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result!.agentTaskPrompt).toBe(original);
  });

  it('github 来源显式命中 → 指令原样透传，不注入 D4 边界', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/gh do something',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [githubSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result!.agentTaskPrompt).toContain('GitHub skill body.');
    expect(result!.agentTaskPrompt).not.toContain('## Local Execution Boundary');
  });
});

describe('augmentRequestBody 暴露 activeLocalSkillDir（方案A 闭环源）', () => {
  it('隐式命中本地索引 Skill → activeLocalSkillDir 等于 skillDir', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [localIndexSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result).not.toBeNull();
    expect(result!.activeLocalSkillDir).toBe('/skills/demo');
  });

  it('显式 /demo 命中本地索引 Skill → activeLocalSkillDir 等于 skillDir', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/demo 写本周周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [localIndexSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(result!.activeLocalSkillDir).toBe('/skills/demo');
  });

  it('未激活本地 Skill（builtin / 旧快照）→ activeLocalSkillDir 为 undefined', () => {
    const builtin = augmentRequestBody(JSON.stringify({
      prompt: '帮我生成本周周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [builtinSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });
    const legacy = augmentRequestBody(JSON.stringify({
      prompt: '帮我生成本周周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [legacyLocalSkill()],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    expect(builtin!.activeLocalSkillDir).toBeUndefined();
    expect(legacy!.activeLocalSkillDir).toBeUndefined();
  });
});

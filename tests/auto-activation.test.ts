// 自动激活（隐式打分）开关：不变式 normalize + 拦截层按节奏门控验证。
// 环境复用 request-augmentation-local.test.ts：无外部依赖、无 mock。

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS,
  normalizeSkillAutoActivationSettings,
  type SkillAutoActivationSettings,
} from '../core/skill/auto-activation-settings';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { LOCAL_INDEX_MARKER } from '../core/skill/local-importer';
import type { Skill } from '../core/types';

const LOCAL_INDEX_INSTRUCTIONS = [
  '# Local Skill: demo',
  '',
  `- ${LOCAL_INDEX_MARKER}`,
  '- Skill directory path: /skills/demo',
  '',
  '## Activation Notice',
  '',
  '- Read the Skill definition file with the local file tool: /skills/demo/SKILL.md',
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

function baseState(auto: SkillAutoActivationSettings) {
  return {
    memories: [],
    skills: [localIndexSkill()],
    activePreset: null,
    modelType: null,
    toolDescriptors: [] as never[],
    messageCount: 0,
    locale: 'en' as const,
    skillAutoActivation: auto,
  };
}

describe('normalizeSkillAutoActivationSettings（联动不变式）', () => {
  it('默认：首条开、每条关', () => {
    expect(DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS).toEqual({ firstMessage: true, everyMessage: false });
  });

  it('每条消息开 ⇒ 首条必开', () => {
    expect(normalizeSkillAutoActivationSettings({ firstMessage: false, everyMessage: true }))
      .toEqual({ firstMessage: true, everyMessage: true });
  });

  it('首条关 ⇒ 每条必关', () => {
    expect(normalizeSkillAutoActivationSettings({ firstMessage: false, everyMessage: true }))
      .toEqual({ firstMessage: true, everyMessage: true });
    expect(normalizeSkillAutoActivationSettings({ firstMessage: false, everyMessage: false }))
      .toEqual({ firstMessage: false, everyMessage: false });
  });

  it('仅首条开（每条关）保持不变', () => {
    expect(normalizeSkillAutoActivationSettings({ firstMessage: true, everyMessage: false }))
      .toEqual({ firstMessage: true, everyMessage: false });
  });

  it('脏数据（非布尔 / undefined）回落到默认', () => {
    expect(normalizeSkillAutoActivationSettings(undefined)).toEqual(DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS);
    expect(normalizeSkillAutoActivationSettings({ firstMessage: 'yes' as unknown as boolean, everyMessage: 1 as unknown as boolean }))
      .toEqual({ firstMessage: false, everyMessage: false });
  });
});

describe('augmentRequestBody 自动激活门控', () => {
  it('两关皆关 → 隐式打分不触发，透传原始输入', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), baseState({ firstMessage: false, everyMessage: false }));
    expect(result!.agentTaskPrompt).toBe('周报');
  });

  it('仅首条开 + 首条消息 → 隐式打分触发，注入索引指令', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: null,
      thinking_enabled: false,
    }), baseState({ firstMessage: true, everyMessage: false }));
    expect(result!.agentTaskPrompt).toContain(LOCAL_INDEX_MARKER);
  });

  it('仅首条开 + 非首条消息 → 隐式打分不触发，透传原始输入', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: 'abc',
      thinking_enabled: false,
    }), baseState({ firstMessage: true, everyMessage: false }));
    expect(result!.agentTaskPrompt).toBe('周报');
  });

  it('每条消息开 + 非首条消息 → 隐式打分触发，注入索引指令', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '周报',
      parent_message_id: 'abc',
      thinking_enabled: false,
    }), baseState({ firstMessage: false, everyMessage: true }));
    expect(result!.agentTaskPrompt).toContain(LOCAL_INDEX_MARKER);
  });

  it('缺省 skillAutoActivation（按 DEFAULT 首条开）+ 首条消息 → 触发', () => {
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
    expect(result!.agentTaskPrompt).toContain(LOCAL_INDEX_MARKER);
  });
});

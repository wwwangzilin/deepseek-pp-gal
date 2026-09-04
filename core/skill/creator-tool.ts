import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import type { JsonValue, Skill, ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../types';

export interface SkillDraftOutput {
  kind: 'skill_draft';
  draft: Skill;
  warnings: string[];
}

export const SKILL_CREATOR_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'skill-creator',
  displayName: 'Skill Creator',
  transport: 'in_process',
};

export const SKILL_CREATOR_TOOL_NAMES = ['skill_draft_create'] as const;
export type SkillCreatorToolName = typeof SKILL_CREATOR_TOOL_NAMES[number];

export function isSkillCreatorToolName(name: string): name is SkillCreatorToolName {
  return (SKILL_CREATOR_TOOL_NAMES as readonly string[]).includes(name);
}

export function createSkillCreatorToolDescriptors(locale: SupportedLocale = DEFAULT_LOCALE): ToolDescriptor[] {
  return [{
    id: 'local:skill-creator:skill_draft_create',
    provider: SKILL_CREATOR_TOOL_PROVIDER,
    name: 'skill_draft_create',
    invocationName: 'skill_draft_create',
    title: translate(locale, 'tool.skillCreator.title'),
    description: translate(locale, 'tool.skillCreator.description'),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: translate(locale, 'tool.skillCreator.nameDescription') },
        description: { type: 'string', description: translate(locale, 'tool.skillCreator.descriptionDescription') },
        instructions: { type: 'string', description: translate(locale, 'tool.skillCreator.instructionsDescription') },
        memoryEnabled: { type: 'boolean', description: translate(locale, 'tool.skillCreator.memoryDescription') },
      },
      required: ['name', 'description', 'instructions'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'low', maxResultBytes: 4096 },
  }];
}

export async function executeSkillCreatorToolCall(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  if (!isSkillCreatorToolName(call.name)) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? SKILL_CREATOR_TOOL_PROVIDER,
      summary: translate(locale, 'tool.runtime.unknownTool'),
      error: {
        code: 'skill_creator_tool_unsupported',
        message: `Unsupported Skill creator tool: ${call.name}`,
        retryable: false,
      },
    };
  }

  try {
    const output = createSkillDraft(call.payload);
    return {
      ok: true,
      name: call.name,
      provider: call.provider ?? SKILL_CREATOR_TOOL_PROVIDER,
      summary: translate(locale, 'tool.skillCreator.draftReady'),
      detail: output.draft.name,
      output: output as unknown as JsonValue,
    };
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? SKILL_CREATOR_TOOL_PROVIDER,
      summary: translate(locale, 'tool.skillCreator.invalidDraft'),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'skill_creator_invalid_draft',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

export function createSkillDraft(value: unknown): SkillDraftOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Skill draft payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  const name = normalizeSkillName(requiredString(payload.name, 'name'));
  const description = requiredString(payload.description, 'description').slice(0, 500);
  const instructions = requiredString(payload.instructions, 'instructions');
  if (instructions.length < 40) {
    throw new Error('instructions must be at least 40 characters');
  }

  const warnings: string[] = [];
  if (instructions.length > 16_000) warnings.push('instructions_truncated');

  return {
    kind: 'skill_draft',
    draft: {
      name,
      description,
      instructions: instructions.slice(0, 16_000),
      source: 'custom',
      memoryEnabled: payload.memoryEnabled === true,
      enabled: true,
      metadata: {
        createdBy: 'skill_draft_create',
      },
    },
    warnings,
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeSkillName(name: string): string {
  const normalized = name.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Skill name cannot be empty');
  return normalized.slice(0, 64);
}

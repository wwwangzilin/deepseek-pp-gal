import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import type { JsonValue, ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../types';
import { getActiveCharacter, getAllCharacters, saveCharacter } from './store';

/**
 * GAL character management tool — lets the model itself create / grow
 * character cards mid-conversation (same UX as the Skill Creator draft tool,
 * but persisted straight into the extension-owned character library).
 */

export const GAL_CHARACTER_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'gal-character',
  displayName: 'GAL Character',
  transport: 'in_process',
};

export const GAL_CHARACTER_TOOL_NAMES = ['gal_character_upsert'] as const;
export type GalCharacterToolName = typeof GAL_CHARACTER_TOOL_NAMES[number];

export function isGalCharacterToolName(name: string): name is GalCharacterToolName {
  return (GAL_CHARACTER_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * The character tool is a GAL-mode capability: only expose it while a
 * character is actually active, so ordinary work conversations never create
 * character cards by accident.
 */
export async function shouldExposeGalCharacterTool(): Promise<boolean> {
  const active = await getActiveCharacter();
  return Boolean(active?.id);
}

export function createGalCharacterToolDescriptors(locale: SupportedLocale = DEFAULT_LOCALE): ToolDescriptor[] {
  return [{
    id: 'local:gal-character:gal_character_upsert',
    provider: GAL_CHARACTER_TOOL_PROVIDER,
    name: 'gal_character_upsert',
    invocationName: 'gal_character_upsert',
    title: translate(locale, 'tool.galCharacter.title'),
    description: translate(locale, 'tool.galCharacter.description'),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: translate(locale, 'tool.galCharacter.nameDescription') },
        color: { type: 'string', description: translate(locale, 'tool.galCharacter.colorDescription') },
        avatar: { type: 'string', description: translate(locale, 'tool.galCharacter.avatarDescription') },
        description: { type: 'string', description: translate(locale, 'tool.galCharacter.descriptionDescription') },
        personality: { type: 'string', description: translate(locale, 'tool.galCharacter.personalityDescription') },
        scenario: { type: 'string', description: translate(locale, 'tool.galCharacter.scenarioDescription') },
        exampleDialogue: { type: 'string', description: translate(locale, 'tool.galCharacter.exampleDescription') },
        greeting: { type: 'string', description: translate(locale, 'tool.galCharacter.greetingDescription') },
        systemPrompt: { type: 'string', description: translate(locale, 'tool.galCharacter.systemDescription') },
        memoryTags: {
          type: 'array',
          items: { type: 'string' },
          description: translate(locale, 'tool.galCharacter.tagsDescription'),
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'low', maxResultBytes: 4096 },
  }];
}

export async function executeGalCharacterToolCall(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  if (!isGalCharacterToolName(call.name)) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? GAL_CHARACTER_TOOL_PROVIDER,
      summary: translate(locale, 'tool.galCharacter.unknown'),
      error: {
        code: 'gal_character_tool_unsupported',
        message: `Unsupported GAL character tool: ${call.name}`,
        retryable: false,
      },
    };
  }

  try {
    const payload = call.payload && typeof call.payload === 'object'
      ? call.payload as Record<string, unknown>
      : {};
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      return {
        ok: false,
        name: call.name,
        provider: call.provider ?? GAL_CHARACTER_TOOL_PROVIDER,
        summary: translate(locale, 'tool.galCharacter.nameRequired'),
        error: {
          code: 'gal_character_name_required',
          message: 'Character name is required',
          retryable: true,
        },
      };
    }

    const stringField = (key: string): string | undefined => (
      typeof payload[key] === 'string' ? (payload[key] as string).trim() : undefined
    );
    const tags = Array.isArray(payload.memoryTags)
      ? payload.memoryTags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : undefined;

    // Upsert by name: growing an existing card keeps its identity + id.
    const existing = (await getAllCharacters()).find(
      (character) => character.name?.trim() === name,
    );

    const saved = await saveCharacter({
      ...(existing ? { id: existing.id } : {}),
      name,
      color: stringField('color') ?? existing?.color ?? undefined,
      avatar: stringField('avatar') ?? existing?.avatar ?? undefined,
      description: stringField('description') ?? existing?.description ?? undefined,
      personality: stringField('personality') ?? existing?.personality ?? undefined,
      scenario: stringField('scenario') ?? existing?.scenario ?? undefined,
      exampleDialogue: stringField('exampleDialogue') ?? existing?.exampleDialogue ?? undefined,
      greeting: stringField('greeting') ?? existing?.greeting ?? undefined,
      systemPrompt: stringField('systemPrompt') ?? existing?.systemPrompt ?? undefined,
      memoryTags: tags ?? existing?.memoryTags ?? undefined,
    } as Parameters<typeof saveCharacter>[0]);

    return {
      ok: true,
      name: call.name,
      provider: call.provider ?? GAL_CHARACTER_TOOL_PROVIDER,
      summary: existing
        ? translate(locale, 'tool.galCharacter.updated')
        : translate(locale, 'tool.galCharacter.saved'),
      detail: saved.name,
      output: {
        id: saved.id,
        name: saved.name,
      } as unknown as JsonValue,
    };
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? GAL_CHARACTER_TOOL_PROVIDER,
      summary: translate(locale, 'tool.galCharacter.failed', {
        error: error instanceof Error ? error.message : String(error),
      }),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'gal_character_save_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

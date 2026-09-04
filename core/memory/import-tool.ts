import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import { getAllMemories } from './store';
import type { JsonValue, MemoryType, ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../types';
import { previewMemoryImport } from './importer';

export const MEMORY_IMPORT_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'memory-import',
  displayName: 'Memory Import',
  transport: 'in_process',
};

export const MEMORY_IMPORT_TOOL_NAMES = ['memory_import_preview'] as const;
export type MemoryImportToolName = typeof MEMORY_IMPORT_TOOL_NAMES[number];

export function isMemoryImportToolName(name: string): name is MemoryImportToolName {
  return (MEMORY_IMPORT_TOOL_NAMES as readonly string[]).includes(name);
}

export function createMemoryImportToolDescriptors(locale: SupportedLocale = DEFAULT_LOCALE): ToolDescriptor[] {
  return [{
    id: 'local:memory-import:memory_import_preview',
    provider: MEMORY_IMPORT_TOOL_PROVIDER,
    name: 'memory_import_preview',
    invocationName: 'memory_import_preview',
    title: translate(locale, 'tool.memoryImport.title'),
    description: translate(locale, 'tool.memoryImport.description'),
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: translate(locale, 'tool.memoryImport.contentDescription') },
        defaultType: { type: 'string', description: translate(locale, 'tool.memoryImport.typeDescription') },
        tags: { type: 'array', description: translate(locale, 'tool.memoryImport.tagsDescription') },
      },
      required: ['content'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'low', maxResultBytes: 4096 },
  }];
}

export async function executeMemoryImportToolCall(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  if (!isMemoryImportToolName(call.name)) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? MEMORY_IMPORT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.runtime.unknownTool'),
      error: {
        code: 'memory_import_tool_unsupported',
        message: `Unsupported memory import tool: ${call.name}`,
        retryable: false,
      },
    };
  }

  try {
    const payload = normalizeMemoryImportPayload(call.payload);
    const existingMemories = await getAllMemories();
    const output = previewMemoryImport({ ...payload, existingMemories });
    return {
      ok: true,
      name: call.name,
      provider: call.provider ?? MEMORY_IMPORT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.memoryImport.previewReady', { count: output.memories.length }),
      detail: translate(locale, 'tool.memoryImport.previewDetail', {
        duplicates: output.duplicates,
        rejected: output.rejected,
      }),
      output: output as unknown as JsonValue,
    };
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? MEMORY_IMPORT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.memoryImport.failed'),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'memory_import_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

function normalizeMemoryImportPayload(value: unknown): {
  content: string;
  defaultType?: MemoryType;
  tags?: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('memory import payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.content !== 'string' || !payload.content.trim()) {
    throw new Error('content must be a non-empty string');
  }
  return {
    content: payload.content,
    defaultType: payload.defaultType as MemoryType | undefined,
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined,
  };
}

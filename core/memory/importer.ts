import type { Memory, MemoryType, NewMemory } from '../types';

export interface MemoryImportPreview {
  kind: 'memory_import_preview';
  memories: NewMemory[];
  duplicates: number;
  rejected: number;
}

const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'topic', 'reference'];

export function previewMemoryImport(input: {
  content: string;
  defaultType?: MemoryType;
  tags?: string[];
  existingMemories?: readonly Memory[];
}): MemoryImportPreview {
  const defaultType = MEMORY_TYPES.includes(input.defaultType as MemoryType)
    ? input.defaultType as MemoryType
    : 'reference';
  const tags = normalizeTags(input.tags);
  const existingKeys = new Set((input.existingMemories ?? []).map((memory) => dedupeKey(memory.content)));
  const seenKeys = new Set<string>();
  let duplicates = 0;
  let rejected = 0;

  const { memories: candidates, rejected: rejectedCandidates } = extractMemoryCandidates(input.content, defaultType, tags);
  rejected += rejectedCandidates;
  const memories: NewMemory[] = [];
  for (const candidate of candidates) {
    const key = dedupeKey(candidate.content);
    if (!key) {
      rejected += 1;
      continue;
    }
    if (existingKeys.has(key) || seenKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    seenKeys.add(key);
    memories.push(candidate);
  }

  return {
    kind: 'memory_import_preview',
    memories: memories.slice(0, 100),
    duplicates,
    rejected,
  };
}

function extractMemoryCandidates(content: string, defaultType: MemoryType, tags: string[]): {
  memories: NewMemory[];
  rejected: number;
} {
  const trimmed = content.trim();
  if (!trimmed) return { memories: [], rejected: 0 };

  const json = parseJson(trimmed);
  if (json) return extractJsonMemories(json, defaultType, tags);

  return {
    memories: trimmed
      .split(/\n{2,}|\n(?=\s*[-*]\s+)/)
      .map((block) => block.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
      .map((block) => createMemoryFromText(block, defaultType, tags)),
    rejected: 0,
  };
}

function extractJsonMemories(value: unknown, defaultType: MemoryType, tags: string[]): {
  memories: NewMemory[];
  rejected: number;
} {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { memories?: unknown }).memories)
      ? (value as { memories: unknown[] }).memories
      : [value];

  const memories: NewMemory[] = [];
  let rejected = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rejected += 1;
      continue;
    }
    try {
      memories.push({
        type: normalizeMemoryType(item.type, defaultType),
        name: normalizeTitle(firstString(item.name, item.title, item.key) ?? firstLine(String(item.content ?? item.text ?? item.value ?? ''))),
        content: requiredContent(firstString(item.content, item.text, item.value) ?? ''),
        description: firstString(item.description, item.summary) ?? '',
        tags: mergeTags(tags, normalizeTags(item.tags)),
        pinned: item.pinned === true,
        ...(typeof item.syncId === 'string' && item.syncId.trim() ? { syncId: item.syncId.trim() } : {}),
      });
    } catch {
      rejected += 1;
    }
  }
  return { memories, rejected };
}

function createMemoryFromText(text: string, type: MemoryType, tags: string[]): NewMemory {
  return {
    type,
    name: normalizeTitle(firstLine(text)),
    content: requiredContent(text),
    description: '',
    tags,
    pinned: false,
  };
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeMemoryType(value: unknown, fallback: MemoryType): MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType) ? value as MemoryType : fallback;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function mergeTags(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'Imported memory';
}

function normalizeTitle(value: string): string {
  const title = value.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
  return (title || 'Imported memory').slice(0, 80);
}

function requiredContent(value: string): string {
  const content = value.trim();
  if (!content) throw new Error('memory content cannot be empty');
  return content.slice(0, 8000);
}

function dedupeKey(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

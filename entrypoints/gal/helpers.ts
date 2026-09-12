/**
 * GAL overlay helpers — typed, DOM-free logic shared by the overlay script.
 *
 * The overlay itself (`gal-view.content.ts`) keeps its deliberate JS style
 * (@ts-nocheck) for the舞台 rendering code; everything that is pure logic
 * lives here so it is type-checked and unit-testable.
 */

import type { GalCharacter } from '../../core/types';

export type GalEmotion = 'happy' | 'angry' | 'shy' | 'sad';

/**
 * Cheap keyword emotion detection for portrait switching. Deliberately
 * rule-based: it only picks a portrait override the user configured, so a
 * wrong guess costs nothing but a picture.
 */
export function detectEmotion(text: unknown): GalEmotion | null {
  const raw = String(text ?? '');
  if (!raw) return null;
  if (/(脸红|害羞|羞死|才不是|笨蛋|别说了|讨厌啦)/.test(raw)) return 'shy';
  if (/(生气|愤怒|混账|混蛋|滚开|哼！|怒)/.test(raw)) return 'angry';
  if (/(呜|哭|难过|伤心|寂寞|别走|舍不得)/.test(raw)) return 'sad';
  if (/(笑|开心|哈哈|太好了|高兴|嘻嘻|愉快)/.test(raw)) return 'happy';
  return null;
}

/** Portrait for the current emotion, falling back to the base avatar. */
export function portraitFor(
  character: Pick<GalCharacter, 'avatar' | 'expressions'> | null | undefined,
  emotion: GalEmotion | null,
  fallback: string,
): string {
  if (!character) return fallback;
  if (emotion) {
    const override = character.expressions?.[emotion];
    if (override) return override;
  }
  return character.avatar || fallback;
}

/** Tool name → friendly Chinese label for the stage status pill. */
export const TOOL_LABELS: Record<string, string> = {
  web_search: '联网搜索',
  web_fetch: '读取网页',
  memory_save: '记忆保存',
  memory_update: '记忆更新',
  memory_delete: '记忆删除',
  memory_import_preview: '记忆导入',
  python_exec: 'Python 执行',
  python_status: 'Python 状态',
  shell_exec: 'Shell 执行',
  shell_status: 'Shell 状态',
  artifact_create: '生成网页',
  artifact_bundle_create: '打包产物',
  skill_draft_create: '起草技能',
  gal_character_upsert: '更新角色卡',
  mcp_discover: 'MCP 发现',
  mcp_describe: 'MCP 说明',
  mcp_invoke: 'MCP 调用',
};

export function toolLabel(name: unknown): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  if (TOOL_LABELS[raw]) return TOOL_LABELS[raw];
  const bare = raw.replace(/^mcp_[a-z0-9_]+_/, '');
  return TOOL_LABELS[bare] ?? raw;
}

/** Story-save (剧情存档) records live in extension storage under this key. */
export const GAL_SAVES_KEY = 'deepseek_pp_gal_saves';
export const GAL_SAVES_LIMIT = 20;

export interface GalSceneSaveLine {
  kind: string;
  text: string;
}

export interface GalSceneSave {
  id: string;
  name: string;
  characterId?: string | null;
  groupId?: string | null;
  speakerIds?: string[];
  lines: GalSceneSaveLine[];
  createdAt: number;
}

export function galStorageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(data ? (data[key] as T) : undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export function galStorageSet(key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    } catch {
      resolve(false);
    }
  });
}

export async function loadGalSaves(): Promise<GalSceneSave[]> {
  const raw = await galStorageGet<GalSceneSave[]>(GAL_SAVES_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function persistGalSaves(saves: GalSceneSave[]): Promise<void> {
  await galStorageSet(GAL_SAVES_KEY, saves.slice(0, GAL_SAVES_LIMIT));
}

/** Affinity gained per conversation turn: faster when distant, slower when close. */
export const AFFINITY_DAILY_CAP = 15;

export function computeAffinityGain(current: number): number {
  return Math.max(1, Math.round((100 - Math.max(0, Math.min(100, current))) / 25));
}

/** Group chat-event memory name, chunked so history never rolls off silently. */
export const GROUP_EVENT_NAME_PREFIX = 'gal-group:';

export function groupEventMemoryName(groupId: string, chunk: number): string {
  return `${GROUP_EVENT_NAME_PREFIX}${groupId}#${chunk}`;
}

/** Extracts the owning group id from any chunked (or legacy) event memory name. */
export function groupIdFromEventMemoryName(name: unknown): string | null {
  const raw = String(name ?? '');
  if (!raw.startsWith(GROUP_EVENT_NAME_PREFIX)) return null;
  const rest = raw.slice(GROUP_EVENT_NAME_PREFIX.length).split('#')[0];
  const groupId = rest.split(/\s+/)[0];
  return groupId || null;
}

/**
 * Group-chat @mentions: returns the mentioned character names in first-appearance
 * order. Only exact member names count, so ordinary "@" text never hijacks the
 * speaker list.
 */
export function parseMentions(text: unknown, memberNames: readonly string[]): string[] {
  const raw = String(text ?? '');
  if (!raw.includes('@')) return [];
  const hits: Array<{ name: string; index: number }> = [];
  for (const name of memberNames) {
    if (!name) continue;
    const index = raw.indexOf('@' + name);
    if (index >= 0) hits.push({ name, index });
  }
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.name);
}

/** Deterministic TTS voice tuning per character (keeps each role distinguishable). */
export function voiceProfileFor(seed: string): { pitch: number; rateScale: number } {
  let hash = 0;
  const raw = String(seed ?? '');
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) % 997;
  return {
    pitch: 0.9 + (hash % 4) * 0.1,
    rateScale: 0.95 + (hash % 3) * 0.05,
  };
}

/** Day period used for the once-per-period greeting. */
export type GalDayPeriod = '深夜' | '早上' | '中午' | '下午' | '晚上';

export function currentDayPeriod(date: Date = new Date()): GalDayPeriod {
  const hour = date.getHours();
  if (hour < 5) return '深夜';
  if (hour < 11) return '早上';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Renders the character-to-character relationship map into the group project's
 * context, so every member can "feel" who is close to whom during group chat.
 */
export function groupRelationsSummary(
  members: ReadonlyArray<{ id: string; name: string; relations?: Record<string, number> }>,
): string {
  const lines: string[] = [];
  for (const member of members) {
    const relations = member.relations ?? {};
    const pairs = members
      .filter((other) => other.id !== member.id)
      .map((other) => ({ name: other.name, value: Math.round(relations[other.id] ?? 0) }))
      .filter((pair) => pair.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
    if (pairs.length === 0) continue;
    lines.push(`${member.name} → ` + pairs.map((pair) => `${pair.name} ${pair.value}`).join('、'));
  }
  return lines.join('\n');
}

/**
 * GAL overlay helpers — typed, DOM-free logic shared by the overlay script.
 *
 * The overlay itself (`gal-view.content.ts`) keeps its deliberate JS style
 * (@ts-nocheck) for the舞台 rendering code; everything that is pure logic
 * lives here so it is type-checked and unit-testable.
 */

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

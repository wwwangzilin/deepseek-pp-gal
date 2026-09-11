import type { GalGroup, NewGalGroup } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
  type RawStorageSlot,
} from '../persistence/versioned-repository';
import {
  decodeGalGroup,
  decodeGalGroupCollection,
  galGroupCollectionCodec,
  normalizeGalGroupInput,
} from './codec';

/**
 * GAL group library — extension-owned local store (chrome.storage.local).
 * A group binds a cast of characters to one deepseek-pp project, which acts as
 * the shared context carrier (project memories + project instructions).
 */

export const GAL_GROUPS_STORAGE_KEY = 'deepseek_pp_gal_groups';
export const GAL_ACTIVE_GROUP_STORAGE_KEY = 'deepseek_pp_gal_active_group_id';

const groupRepository = createVersionedRepository({
  label: 'gal-groups',
  createDefault: () => [],
  codec: galGroupCollectionCodec,
  storage: createChromeStorageSlot(GAL_GROUPS_STORAGE_KEY),
});
const activeGroupStorage = createChromeStorageSlot(GAL_ACTIVE_GROUP_STORAGE_KEY);

export async function getAllGroups(): Promise<GalGroup[]> {
  return groupRepository.read();
}

export async function saveGroup(group: NewGalGroup): Promise<GalGroup> {
  return withSyncLocalStateLock(async () => {
    const input = normalizeGalGroupInput(
      group as unknown as Record<string, unknown>,
      'galGroup',
    );
    const groups = await groupRepository.readAlreadyLocked();
    const id = input.id as string;
    const existing = groups.find((item) => item.id === id);
    const now = Date.now();
    const merged: GalGroup = decodeGalGroup({
      ...input,
      id,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    }, 'galGroup');
    const next = existing
      ? groups.map((item) => (item.id === id ? merged : item))
      : [...groups, merged];
    await groupRepository.writeAfterReadAlreadyLocked(next);
    return merged;
  });
}

/** Binds (or clears) the shared-context project for a group. */
export async function setGroupProjectId(id: string, projectId: string | null): Promise<GalGroup> {
  return withSyncLocalStateLock(async () => {
    const groups = await groupRepository.readAlreadyLocked();
    const existing = groups.find((item) => item.id === id);
    if (!existing) throw new Error(`Group was not found: ${id}`);
    const merged = decodeGalGroup({
      ...existing,
      projectId: projectId ?? undefined,
      updatedAt: Date.now(),
    }, 'galGroup');
    await groupRepository.writeAfterReadAlreadyLocked(
      groups.map((item) => (item.id === id ? merged : item)),
    );
    return merged;
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const groups = await groupRepository.readAlreadyLocked();
    await groupRepository.writeAfterReadAlreadyLocked(groups.filter((item) => item.id !== id));
    if (await getActiveGroupIdAlreadyLocked() === id) {
      await activeGroupStorage.remove();
    }
  });
}

export async function getActiveGroupId(): Promise<string | null> {
  return withSyncLocalStateLock(getActiveGroupIdAlreadyLocked);
}

export async function getActiveGroupIdAlreadyLocked(): Promise<string | null> {
  return decodeActiveGroupSlot(await activeGroupStorage.read());
}

export async function setActiveGroupId(id: string | null): Promise<void> {
  await withSyncLocalStateLock(async () => {
    if (id === null) {
      await activeGroupStorage.remove();
      return;
    }
    const trimmed = id.trim();
    if (!trimmed) throw new Error('Group id is required');
    const groups = await groupRepository.readAlreadyLocked();
    if (!groups.some((group) => group.id === trimmed)) {
      throw new Error(`Group was not found: ${trimmed}`);
    }
    await activeGroupStorage.write(trimmed);
  });
}

export async function getActiveGroup(): Promise<GalGroup | null> {
  return withSyncLocalStateLock(async () => {
    const [activeId, groups] = await Promise.all([
      getActiveGroupIdAlreadyLocked(),
      groupRepository.readAlreadyLocked(),
    ]);
    if (!activeId) return null;
    return groups.find((group) => group.id === activeId) ?? null;
  });
}

export { decodeGalGroupCollection };

function decodeActiveGroupSlot(slot: RawStorageSlot): string | null {
  return slot.present && typeof slot.value === 'string' && slot.value.trim() !== ''
    ? slot.value.trim()
    : null;
}

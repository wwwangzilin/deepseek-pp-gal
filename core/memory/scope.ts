import type { Memory } from '../types';

export function filterMemoriesByProjectScope(
  memories: readonly Memory[],
  projectId?: string | null,
): Memory[] {
  return memories.filter((memory) => {
    if (memory.scope === 'project') return Boolean(projectId && memory.projectId === projectId);
    return memory.scope === undefined || memory.scope === 'global';
  });
}

/**
 * Character-dimension filter: only "global shared memories (no characterId)
 * plus memories owned by the currently active character" stay visible.
 * - No active character: character-owned memories are never injected
 *   (keeps plain non-character mode clean);
 * - With an active character: that character's memories and the shared
 *   global memories are candidates; other characters' memories never leak.
 */
export function filterMemoriesByCharacterScope(
  memories: readonly Memory[],
  activeCharacterId?: string | null,
): Memory[] {
  const characterId = activeCharacterId && activeCharacterId.trim() !== ''
    ? activeCharacterId
    : null;
  return memories.filter((memory) => {
    if (!memory.characterId || memory.characterId.trim() === '') return true;
    return characterId !== null && memory.characterId === characterId;
  });
}

/** Injection candidates: project scope first, then active-character scope. */
export function filterMemoriesForInjection(
  memories: readonly Memory[],
  projectId?: string | null,
  activeCharacterId?: string | null,
): Memory[] {
  return filterMemoriesByCharacterScope(
    filterMemoriesByProjectScope(memories, projectId),
    activeCharacterId,
  );
}

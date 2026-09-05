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
 * 角色维度过滤：只有「全局共享记忆（无 characterId）+ 当前激活角色的记忆」可见。
 * - activeCharacterId 为空（无 GAL 角色激活）：角色记忆一律不可见（保持非角色模式行为干净）；
 * - 激活角色后：该角色专属记忆与其共享的全局记忆一起进入候选，其它角色的记忆不泄漏。
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

/** 注入候选记忆：先按项目作用域过滤，再按激活角色过滤。 */
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

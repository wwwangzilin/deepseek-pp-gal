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

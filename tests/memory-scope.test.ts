import { describe, expect, it } from 'vitest';
import { filterMemoriesByProjectScope } from '../core/memory/scope';
import type { Memory } from '../core/types';

describe('memory scope filtering', () => {
  it('keeps only global memories when no project is bound', () => {
    const filtered = filterMemoriesByProjectScope([
      memory(1, 'global', undefined, 'Global'),
      memory(2, 'project', 'project-1', 'Project one'),
      memory(3, 'project', 'project-2', 'Project two'),
    ], null);

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  it('keeps global memories plus memories from the current project', () => {
    const filtered = filterMemoriesByProjectScope([
      memory(1, 'global', undefined, 'Global'),
      memory(2, 'project', 'project-1', 'Project one'),
      memory(3, 'project', 'project-2', 'Project two'),
    ], 'project-1');

    expect(filtered.map((item) => item.id)).toEqual([1, 2]);
  });
});

function memory(
  id: number,
  scope: Memory['scope'],
  projectId: string | undefined,
  name: string,
): Memory {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    type: 'reference',
    name,
    content: `${name} content`,
    description: '',
    tags: [],
    pinned: true,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}

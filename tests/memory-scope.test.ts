import { describe, expect, it } from 'vitest';
import {
  filterMemoriesByCharacterScope,
  filterMemoriesByProjectScope,
  filterMemoriesForInjection,
} from '../core/memory/scope';
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

describe('character scope filtering', () => {
  it('drops character-owned memories when no character is active (plain mode)', () => {
    const filtered = filterMemoriesByCharacterScope([
      memory(1, 'global', undefined, 'Global', undefined),
      memory(2, 'global', undefined, 'Char A memory', 'char-a'),
      memory(3, 'global', undefined, 'Char B memory', 'char-b'),
    ], null);

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });

  it('keeps global memories plus memories owned by the active character only', () => {
    const filtered = filterMemoriesByCharacterScope([
      memory(1, 'global', undefined, 'Global', undefined),
      memory(2, 'global', undefined, 'Char A memory', 'char-a'),
      memory(3, 'global', undefined, 'Char B memory', 'char-b'),
    ], 'char-a');

    expect(filtered.map((item) => item.id)).toEqual([1, 2]);
  });

  it('treats empty characterId like a global memory', () => {
    const filtered = filterMemoriesByCharacterScope([
      memory(1, 'global', undefined, 'Empty tag', ''),
    ], 'char-a');

    expect(filtered.map((item) => item.id)).toEqual([1]);
  });
});

describe('injection scope filtering (project + character)', () => {
  it('applies project scope then active character scope', () => {
    const filtered = filterMemoriesForInjection([
      memory(1, 'global', undefined, 'Global', undefined),
      memory(2, 'project', 'project-1', 'Project one shared', undefined),
      memory(3, 'project', 'project-2', 'Project two hidden', undefined),
      memory(4, 'global', undefined, 'Char A memory', 'char-a'),
      memory(5, 'global', undefined, 'Char B memory', 'char-b'),
      memory(6, 'project', 'project-1', 'Char A project memory', 'char-a'),
    ], 'project-1', 'char-a');

    expect(filtered.map((item) => item.id)).toEqual([1, 2, 4, 6]);
  });

  it('keeps behavior unchanged when nothing is character-bound (legacy data)', () => {
    const filtered = filterMemoriesForInjection([
      memory(1, 'global', undefined, 'Global', undefined),
      memory(2, 'project', 'project-1', 'Project one', undefined),
    ], 'project-1', null);

    expect(filtered.map((item) => item.id)).toEqual([1, 2]);
  });
});

function memory(
  id: number,
  scope: Memory['scope'],
  projectId: string | undefined,
  name: string,
  characterId?: string,
): Memory {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    characterId,
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

import { describe, expect, it } from 'vitest';
import { MAX_AT_PANEL_RESULTS, parseAtTrigger, searchTrustedFiles } from '../core/trusted-directory/at-panel';
import type { TrustedFileMeta } from '../core/trusted-directory/types';

function entry(relativePath: string, name: string, kind: 'image' | 'text' = 'text'): TrustedFileMeta {
  return { relativePath, name, sizeBytes: 1, kind, lastModified: 1 };
}

describe('parseAtTrigger', () => {
  it('opens the panel when the last token starts with @', () => {
    expect(parseAtTrigger('@')).toEqual({ active: true, query: '' });
    expect(parseAtTrigger('查看 @src')).toEqual({ active: true, query: 'src' });
    expect(parseAtTrigger('查看 @src ')).toEqual({ active: true, query: 'src' });
  });

  it('stays closed without an @ token or when @ is mid-token', () => {
    expect(parseAtTrigger('')).toEqual({ active: false, query: '' });
    expect(parseAtTrigger('plain text')).toEqual({ active: false, query: '' });
    expect(parseAtTrigger('mail a@b.com')).toEqual({ active: false, query: '' });
  });

  it('closes when the user keeps typing past the @ token', () => {
    expect(parseAtTrigger('查看 @src 然后')).toEqual({ active: false, query: '' });
  });
});

describe('searchTrustedFiles', () => {
  const files = [
    entry('proj/src/App.tsx', 'App.tsx'),
    entry('proj/src/main.ts', 'main.ts'),
    entry('proj/docs/README.md', 'README.md'),
    entry('proj/assets/logo.png', 'logo.png', 'image'),
  ];

  it('returns all entries up to the limit for an empty query', () => {
    expect(searchTrustedFiles(files, '')).toHaveLength(4);
  });

  it('matches case-insensitively against path and name', () => {
    expect(searchTrustedFiles(files, 'SRC').map((item) => item.relativePath))
      .toEqual(['proj/src/App.tsx', 'proj/src/main.ts']);
    expect(searchTrustedFiles(files, 'readme').map((item) => item.name)).toEqual(['README.md']);
    expect(searchTrustedFiles(files, 'logo').map((item) => item.name)).toEqual(['logo.png']);
  });

  it('returns no matches for a missing query', () => {
    expect(searchTrustedFiles(files, 'nope')).toEqual([]);
  });

  it('respects the result limit', () => {
    const many = Array.from({ length: MAX_AT_PANEL_RESULTS + 10 }, (_, index) =>
      entry(`proj/f${index}.ts`, `f${index}.ts`),
    );
    expect(searchTrustedFiles(many, '')).toHaveLength(MAX_AT_PANEL_RESULTS);
  });
});

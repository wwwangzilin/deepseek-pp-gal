/**
 * pi integration storage boundary (Issue A4-T1).
 *
 * The pi loop context is current-turn working memory only: the pi modules
 * must not introduce any new persistence surface (IndexedDB, localStorage,
 * chrome.storage, sync). The released memory/trace/state stores stay the
 * single authority.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectTsFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...collectTsFiles(absolute));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(absolute);
    }
  }
  return files;
}

const PI_MODULE_DIR = resolve(import.meta.dirname, '../core/inline-agent/pi');

const PERSISTENCE_MARKERS = [
  /indexedDB/i,
  /localStorage/i,
  /chrome\.storage/i,
  /browser\.storage/i,
  /sessionStorage/i,
  /createObjectStore/i,
  /IDBDatabase/i,
];

describe('pi integration storage boundary', () => {
  it('pi modules contain no persistence surface', () => {
    const files = collectTsFiles(PI_MODULE_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const marker of PERSISTENCE_MARKERS) {
        if (marker.test(source)) {
          violations.push(`${file} matches ${marker}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

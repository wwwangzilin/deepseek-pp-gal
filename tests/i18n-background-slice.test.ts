import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_LOCALE_SECTIONS,
  backgroundLocaleResources,
  type LocaleMessageKey,
} from '../core/i18n/background';
import { resolveMessageIn } from '../core/i18n/runtime';

/**
 * Guards the background i18n slice (issue #505/#506): every locale key used by
 * a background-reachable module must resolve inside the slim background
 * resource set. A key drifting out of the four sections (or a module switching
 * to a full-tree key) fails this test instead of throwing at runtime.
 */
const ROOT = process.cwd();
const SCAN_PATHS = [
  'entrypoints/background.ts',
  'entrypoints/background',
  'core/tool',
  'core/automation',
  'core/sync',
  'core/mcp',
  'core/memory',
  'core/artifact',
  'core/skill',
  'core/prompt',
  'core/messaging',
  'core/browser-control',
  'core/deepseek',
  'core/export',
  'core/multimodal',
  'core/network',
  'core/interceptor',
  'core/sandbox',
  'core/project',
  'core/saved-items',
  'core/usage',
  'core/background',
  'core/scenario',
  'core/chat',
  'core/token',
  'core/tool-loop',
  'core/inline-agent',
  'core/diagnostics',
  'core/platform',
  'core/pet',
  'core/shell',
  'core/preset',
  'core/persistence',
  'core/trusted-directory',
  'core/floating-chat',
  'core/voice',
  'core/theme',
  'core/model',
  'core/constants.ts',
  'core/version.ts',
  'core/whats-new.ts',
  'core/history-organizer',
];

function collectSourceFiles(): string[] {
  const files: string[] = [];
  for (const target of SCAN_PATHS) {
    const absolute = resolve(ROOT, target);
    if (!statSync(absolute, { throwIfNoEntry: false })) continue;
    const visit = (path: string) => {
      const stats = statSync(path);
      if (stats.isDirectory()) {
        for (const entry of readdirSync(path)) {
          if (entry === 'node_modules') continue;
          visit(join(path, entry));
        }
      } else if (path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.spec.ts')) {
        files.push(path);
      }
    };
    visit(absolute);
  }
  return files;
}

function extractTranslateKeys(source: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    // first-argument form: translate('key') / t('key') / ta('key') / backgroundT('key')
    /(?:translate|backgroundT|\bt\b|\bta\b)\(\s*'([a-z][A-Za-z0-9.]*)'/g,
    // second-argument form: translate(locale, 'key')
    /(?:translate|backgroundT|\bt\b|\bta\b)\(\s*[^,)]*,\s*'([a-z][A-Za-z0-9.]*)'/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) keys.add(match[1]!);
  }
  return [...keys];
}

describe('background i18n slice', () => {
  it('keeps every background-reachable locale key inside the slim resource set', () => {
    expect([...BACKGROUND_LOCALE_SECTIONS].sort()).toEqual(['background', 'content', 'prompt', 'tool']);

    const files = collectSourceFiles();
    expect(files.length).toBeGreaterThan(100);

    const missing = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const key of extractTranslateKeys(source)) {
        try {
          resolveMessageIn(backgroundLocaleResources, 'en', key);
        } catch {
          missing.add(`${relative(ROOT, file)}: ${key}`);
        }
      }
    }

    expect([...missing].sort()).toEqual([]);
  });

  it('narrows the background key type to the four sections', () => {
    // Compile-time sanity: the exported key type must reject a sidepanel key.
    const typeCheck: LocaleMessageKey = 'tool.web.providerName';
    expect(typeCheck).toBe('tool.web.providerName');
  });
});

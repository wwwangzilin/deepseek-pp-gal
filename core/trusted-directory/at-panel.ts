import type { TrustedFileMeta } from './types';

/**
 * Pure helpers for the #475 P1 @-panel: trigger parsing and file search.
 * No browser or React dependencies so the behavior is unit-testable.
 */

/** Maximum rows rendered in the @ panel for one query. */
export const MAX_AT_PANEL_RESULTS = 200;

export interface AtTrigger {
  active: boolean;
  query: string;
}

/**
 * Detects whether the last whitespace-delimited token of the composer text
 * starts with `@`. The panel stays open while the user refines the query and
 * closes once the @ token is no longer the trailing token.
 */
export function parseAtTrigger(text: string): AtTrigger {
  const trimmed = text.trimEnd();
  if (trimmed === '') return { active: false, query: '' };
  const tokens = trimmed.split(/\s+/);
  const last = tokens[tokens.length - 1] ?? '';
  if (!last.startsWith('@')) return { active: false, query: '' };
  return { active: true, query: last.slice(1) };
}

/**
 * Case-insensitive substring search over relative path and file name.
 * Input should already be sorted; the result keeps that order.
 */
export function searchTrustedFiles(
  files: readonly TrustedFileMeta[],
  query: string,
  limit: number = MAX_AT_PANEL_RESULTS,
): TrustedFileMeta[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return files.slice(0, limit);
  const matches: TrustedFileMeta[] = [];
  for (const file of files) {
    if (
      file.relativePath.toLowerCase().includes(normalized)
      || file.name.toLowerCase().includes(normalized)
    ) {
      matches.push(file);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

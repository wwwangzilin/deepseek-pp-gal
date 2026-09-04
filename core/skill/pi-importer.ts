/**
 * pi-ecosystem SKILL.md bridge (Issue B3-T3).
 *
 * DeepSeek++ already imports SKILL.md directories through the released local
 * pipeline (`previewLocalSkillSource` / `importLocalSkillSource` /
 * `parseSkillDoc`). This module is the explicit pi-ecosystem bridge: it
 * documents and exposes the pi-compatible entry surface (agentskills.io
 * format) with ZERO runtime dependency on `@earendil-works/*` packages.
 *
 * Design rules:
 *  - **Format bridge, not runtime dependency**: parsing reuses
 *    `parseSkillDoc` (single parser truth). pi harness modules (skill
 *    loaders and prompt formatters) are NEVER imported — pi prompt
 *    templates must not enter the wire (prompt-bytes invariant, AGENTS.md)
 *    and the FileSystem/Shell ExecutionEnv dependency surface stays out of
 *    the bundle.
 *  - **App-owned semantics**: pi's `disable-model-invocation` frontmatter is
 *    tolerated by the parser but model-visibility enablement stays app-owned
 *    (metadata-preserving, no semantic change) — pinned by
 *    `tests/pi-skill-importer.test.ts`.
 *  - **No new persistence**: community skills land through the existing
 *    local-import path; no new storage keys (pi-storage-boundary guard).
 */

import { parseSkillDoc, type ParsedSkillDoc } from './local-importer';

export type { ParsedSkillDoc };

/** pi-ecosystem frontmatter fields this bridge understands (metadata-preserving). */
export interface PiSkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  lastUpdated?: string;
  /** pi-specific flag; tolerated (parser keeps it in body/metadata), app-owned semantics. */
  disableModelInvocation?: boolean;
}

/**
 * Parses one pi-ecosystem SKILL.md document (agentskills.io format) into the
 * DeepSeek++ parsed-skill shape. Delegates to the shared parser truth;
 * behavior identical to the local-import pipeline.
 */
export function parsePiSkillMarkdown(raw: string, path: string): ParsedSkillDoc {
  return parseSkillDoc(raw, path);
}

/**
 * Reads pi-ecosystem frontmatter flags (metadata-preserving bridge). The
 * parsed doc is authoritative; this is the explicit mapping surface for
 * pi-specific fields so a future semantic decision has one place to land.
 */
export function readPiSkillFrontmatter(raw: string): PiSkillFrontmatter {
  const parsed = parseSkillDoc(raw, 'SKILL.md');
  return {
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    lastUpdated: parsed.lastUpdated,
    disableModelInvocation: /disable-model-invocation:\s*true/.test(raw),
  };
}

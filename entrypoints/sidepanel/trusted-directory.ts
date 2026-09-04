import {
  scanTrustedFiles,
  type TrustedFileLike,
} from '../../core/trusted-directory/scan';
import type { TrustedFileMeta } from '../../core/trusted-directory/types';

/**
 * In-memory trusted-directory session for the current sidepanel lifetime.
 * `File` handles cannot be persisted, so this state lives in a module
 * singleton shared by the settings subpage (picker) and the chat page
 * (@ panel). After a sidepanel reload the persisted summary remains, but the
 * live session is null and the UI must ask the user to re-authorize.
 */

export interface TrustedDirectorySessionFile extends TrustedFileMeta {
  file: File;
}

export interface TrustedDirectorySession {
  rootName: string;
  pickedAt: number;
  files: TrustedDirectorySessionFile[];
  skippedCount: number;
  truncated: boolean;
}

let session: TrustedDirectorySession | null = null;

export function getTrustedDirectorySession(): TrustedDirectorySession | null {
  return session;
}

export function setTrustedDirectorySession(next: TrustedDirectorySession | null): void {
  session = next;
}

function rootNameOf(files: readonly TrustedFileLike[]): string {
  for (const file of files) {
    const relative = file.webkitRelativePath;
    if (relative) {
      const first = relative.split('/')[0];
      if (first) return first;
    }
  }
  return files[0]?.name ?? '';
}

/** Scans a picker FileList and builds the live session (or null when empty). */
export function buildTrustedDirectorySession(files: readonly File[]): TrustedDirectorySession | null {
  if (files.length === 0) return null;
  const scanned = scanTrustedFiles(files);
  const byPath = new Map<string, File>();
  for (const file of files) {
    const relative = file.webkitRelativePath || file.name;
    byPath.set(relative, file);
  }
  const sessionFiles: TrustedDirectorySessionFile[] = [];
  for (const meta of scanned.files) {
    const file = byPath.get(meta.relativePath);
    if (!file) continue;
    sessionFiles.push({ ...meta, file });
  }
  return {
    rootName: rootNameOf(files),
    pickedAt: Date.now(),
    files: sessionFiles,
    skippedCount: scanned.skippedCount,
    truncated: scanned.truncated,
  };
}

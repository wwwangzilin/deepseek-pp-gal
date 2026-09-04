/**
 * Trusted-directory contract for #475 (@ file references).
 *
 * The trusted directory is authorized by the user through a web page
 * directory picker (`<input type=file webkitdirectory>`). Only metadata is
 * persisted; `File` handles exist for the current sidepanel session only.
 * Local paths and file content never leave the machine except through the
 * existing DeepSeek image-upload channel (uploaded file IDs, never paths).
 */

export const TRUSTED_DIRECTORY_SCHEMA_VERSION = 1 as const;

/** Kind used by the @ panel: only images are actionable today (P1). */
export type TrustedFileKind = 'image' | 'text' | 'other';

/** Lightweight metadata that is safe to persist (no absolute paths). */
export interface TrustedFileMeta {
  /** Root-relative path reported by the picker (webkitRelativePath). */
  relativePath: string;
  name: string;
  sizeBytes: number;
  kind: TrustedFileKind;
  lastModified: number;
}

/**
 * Persisted summary of the most recent authorization. File handles cannot
 * survive a reload, so the file list itself is never persisted; the summary
 * lets the settings page show an honest "expired, re-authorize" state.
 */
export interface TrustedDirectoryMeta {
  schemaVersion: typeof TRUSTED_DIRECTORY_SCHEMA_VERSION;
  rootName: string;
  pickedAt: number;
  fileCount: number;
  totalBytes: number;
  skippedCount: number;
  truncated: boolean;
}

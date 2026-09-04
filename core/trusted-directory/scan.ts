import type { TrustedFileKind, TrustedFileMeta } from './types';

/**
 * Deterministic, browser-free scan rules for the trusted-directory picker
 * (#475 P0). Everything here operates on a minimal file-like shape so the
 * logic is unit-testable without DOM `File` objects.
 */

/** Minimum shape required from the webkitdirectory `FileList`. */
export interface TrustedFileLike {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
  webkitRelativePath?: string;
}

export interface TrustedScanResult {
  files: TrustedFileMeta[];
  skippedCount: number;
  truncated: boolean;
}

/** Directory segments that are never indexed (build/VCS/cache/IDE output). */
export const IGNORED_DIR_SEGMENTS = new Set([
  '.cache',
  '.git',
  '.gradle',
  '.hg',
  '.idea',
  '.mypy_cache',
  '.next',
  '.parcel-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.terraform',
  '.tox',
  '.turbo',
  '.venv',
  '.vscode',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'env',
  'node_modules',
  'out',
  'target',
  'venv',
]);

/** Exact file names that are never indexed. */
const IGNORED_EXACT_FILE_NAMES = new Set([
  '.DS_Store',
  '.env',
  'Thumbs.db',
  'credentials',
  'desktop.ini',
  'id_ed25519',
  'id_rsa',
]);

/** File-name prefixes/suffixes treated as secrets or credentials. */
const IGNORED_FILE_PREFIXES = ['.env.'] as const;
const IGNORED_FILE_SUFFIXES = ['.key', '.p12', '.pem', '.pfx', '.ppk'] as const;

/** Binary/deprecated image extensions are indexed only when text-like parsing is irrelevant; images stay actionable. */
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

/** Canonical image MIME types used when the picker reports an empty/unknown type. */
export const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const TEXT_MIME_PREFIXES = ['text/'] as const;
const TEXT_MIME_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/shellscript',
  'application/toml',
  'application/typescript',
  'application/xml',
  'application/x-httpd-php',
  'application/x-sh',
  'application/yaml',
]);

const TEXT_EXTENSIONS = new Set([
  'astro', 'awk', 'bash', 'bat', 'c', 'cc', 'cfg', 'clj', 'cmd', 'conf', 'cpp', 'cs', 'csh',
  'css', 'csv', 'cxx', 'dart', 'dockerfile', 'ex', 'exs', 'fish', 'fs', 'go', 'gradle',
  'graphql', 'groovy', 'h', 'hpp', 'hs', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'kt',
  'less', 'lua', 'm', 'makefile', 'md', 'ml', 'mjs', 'php', 'pl', 'prisma', 'proto', 'ps1',
  'py', 'r', 'rb', 'rs', 'sass', 'scala', 'scss', 'sh', 'sql', 'svelte', 'swift', 'toml',
  'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zsh',
]);

/** Hard index budgets (per the #475 safety boundary). */
export const MAX_TRUSTED_FILES = 2000;
export const MAX_SINGLE_FILE_SIZE_BYTES = 32 * 1024 * 1024;
export const MAX_TOTAL_INDEX_BYTES = 512 * 1024 * 1024;

function getRelativePath(file: TrustedFileLike): string {
  return file.webkitRelativePath && file.webkitRelativePath.length > 0
    ? file.webkitRelativePath
    : file.name;
}

function isIgnoredPath(relativePath: string, name: string): boolean {
  const segments = relativePath.split('/');
  if (segments.length > 1) {
    // The first segment is the picker root, which the user explicitly
    // authorized even when it looks like a build/cache name (e.g. a project
    // folder literally named `build`). Only components below the root count.
    const belowRoot = segments.slice(1);
    if (belowRoot.some((segment) => IGNORED_DIR_SEGMENTS.has(segment))) {
      return true;
    }
  }
  if (IGNORED_EXACT_FILE_NAMES.has(name)) return true;
  if (IGNORED_FILE_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return IGNORED_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Effective MIME type for upload validation/payloads. Picker files whose
 * `.type` is empty or `application/octet-stream` still classify as images by
 * extension; normalize them so the @ panel rows are actually attachable.
 */
export function normalizeImageMimeType(name: string, mime: string): string {
  if (mime.toLowerCase().startsWith('image/')) return mime;
  return IMAGE_MIME_BY_EXTENSION[getExtension(name)] ?? mime;
}

export function classifyTrustedFile(file: TrustedFileLike): TrustedFileKind {
  const mime = file.type.toLowerCase();
  const extension = getExtension(file.name);
  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (
    TEXT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))
    || TEXT_MIME_TYPES.has(mime)
    || TEXT_EXTENSIONS.has(extension)
  ) {
    return 'text';
  }
  return 'other';
}

function isOversized(file: TrustedFileLike): boolean {
  return file.size > MAX_SINGLE_FILE_SIZE_BYTES;
}

export function scanTrustedFiles(files: readonly TrustedFileLike[]): TrustedScanResult {
  const indexed: TrustedFileMeta[] = [];
  const seenPaths = new Set<string>();
  let skippedCount = 0;
  let truncated = false;
  let totalBytes = 0;

  for (const file of files) {
    const relativePath = getRelativePath(file);
    if (isIgnoredPath(relativePath, file.name)) {
      skippedCount += 1;
      continue;
    }
    if (isOversized(file)) {
      skippedCount += 1;
      continue;
    }
    if (seenPaths.has(relativePath)) {
      // Duplicate path (same file listed twice or two roots colliding):
      // index once, count the extra occurrence as skipped (byPath dedup).
      skippedCount += 1;
      continue;
    }
    if (
      indexed.length >= MAX_TRUSTED_FILES
      || totalBytes + file.size > MAX_TOTAL_INDEX_BYTES
    ) {
      truncated = true;
      continue;
    }
    seenPaths.add(relativePath);
    indexed.push({
      relativePath,
      name: file.name,
      sizeBytes: file.size,
      kind: classifyTrustedFile(file),
      lastModified: typeof file.lastModified === 'number' ? file.lastModified : 0,
    });
    totalBytes += file.size;
  }

  indexed.sort((a, b) => {
    const left = a.relativePath.toLowerCase();
    const right = b.relativePath.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return { files: indexed, skippedCount, truncated };
}

export function countTrustedFilesByKind(files: readonly TrustedFileMeta[]): {
  images: number;
  text: number;
  other: number;
} {
  let images = 0;
  let text = 0;
  let other = 0;
  for (const file of files) {
    if (file.kind === 'image') images += 1;
    else if (file.kind === 'text') text += 1;
    else other += 1;
  }
  return { images, text, other };
}

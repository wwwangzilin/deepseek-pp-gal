#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';

const DIST_DIRS = [
  'dist/chrome-mv3',
  'dist/edge-mv3',
  'dist/firefox-mv3',
];
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json']);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

let checked = 0;
const errors = [];

for (const dir of DIST_DIRS) {
  if (!await exists(dir)) continue;
  for await (const file of walk(dir)) {
    if (!TEXT_EXTENSIONS.has(getExtension(file))) continue;
    checked += 1;
    const bytes = await readFile(file);
    let text;
    try {
      text = utf8Decoder.decode(bytes);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (file.endsWith('.js')) {
      const nonAscii = findFirstNonAscii(text);
      if (nonAscii) {
        errors.push(`${file}: JavaScript output contains non-ASCII character ${nonAscii.codePoint} at offset ${nonAscii.offset}`);
      }
    }
  }
}

if (checked === 0) {
  throw new Error('No built extension text assets found. Run a browser build first.');
}

if (errors.length > 0) {
  console.error('Extension UTF-8 asset check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Extension UTF-8/ASCII asset check passed (${checked} files scanned)`);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function getExtension(path) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function findFirstNonAscii(text) {
  let offset = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0x7f) {
      return {
        codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
        offset,
      };
    }
    offset += char.length;
  }
  return null;
}

import { describe, expect, it } from 'vitest';
import {
  IMAGE_MIME_BY_EXTENSION,
  MAX_SINGLE_FILE_SIZE_BYTES,
  MAX_TOTAL_INDEX_BYTES,
  MAX_TRUSTED_FILES,
  classifyTrustedFile,
  countTrustedFilesByKind,
  normalizeImageMimeType,
  scanTrustedFiles,
  type TrustedFileLike,
} from '../core/trusted-directory/scan';

function file(partial: Partial<TrustedFileLike> & { name: string }): TrustedFileLike {
  return {
    size: 10,
    type: '',
    lastModified: 1,
    webkitRelativePath: partial.name,
    ...partial,
  };
}

describe('classifyTrustedFile', () => {
  it('classifies images from mime type or extension', () => {
    expect(classifyTrustedFile(file({ name: 'a.png', type: 'image/png' }))).toBe('image');
    expect(classifyTrustedFile(file({ name: 'b.JPG', type: 'application/octet-stream' }))).toBe('image');
    expect(classifyTrustedFile(file({ name: 'c.svg', type: 'image/svg+xml' }))).toBe('image');
  });

  it('classifies text from mime type or common source extensions', () => {
    expect(classifyTrustedFile(file({ name: 'a.ts', type: '' }))).toBe('text');
    expect(classifyTrustedFile(file({ name: 'b.md', type: 'text/markdown' }))).toBe('text');
    expect(classifyTrustedFile(file({ name: 'c.json', type: 'application/json' }))).toBe('text');
    expect(classifyTrustedFile(file({ name: 'noext', type: 'text/plain' }))).toBe('text');
  });

  it('classifies unknown binaries as other', () => {
    expect(classifyTrustedFile(file({ name: 'a.bin', type: 'application/octet-stream' }))).toBe('other');
    expect(classifyTrustedFile(file({ name: 'b.zip', type: '' }))).toBe('other');
  });
});

describe('scanTrustedFiles', () => {
  it('indexes files with root-relative paths and stable sorting', () => {
    const result = scanTrustedFiles([
      file({ name: 'zeta.txt', webkitRelativePath: 'root/zeta.txt' }),
      file({ name: 'alpha.png', webkitRelativePath: 'root/alpha.png', size: 12 }),
      file({ name: 'beta.md', webkitRelativePath: 'root/beta.md', size: 3 }),
    ]);
    expect(result.skippedCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.files.map((item) => item.relativePath)).toEqual([
      'root/alpha.png',
      'root/beta.md',
      'root/zeta.txt',
    ]);
    expect(result.files[0]).toMatchObject({ name: 'alpha.png', kind: 'image', sizeBytes: 12 });
  });

  it('does not ignore the picker root even when it matches an ignored segment name', () => {
    const result = scanTrustedFiles([
      file({ name: 'src.ts', webkitRelativePath: 'build/src.ts' }),
      file({ name: 'out.ts', webkitRelativePath: 'out/out.ts' }),
      file({ name: 'env.ts', webkitRelativePath: 'env/env.ts' }),
      // A nested ignored directory below the root is still skipped.
      file({ name: 'x.ts', webkitRelativePath: 'build/dist/x.ts' }),
      file({ name: 'y.ts', webkitRelativePath: 'out/node_modules/y.ts' }),
    ]);
    expect(result.files.map((item) => item.relativePath)).toEqual([
      'build/src.ts',
      'env/env.ts',
      'out/out.ts',
    ]);
    expect(result.skippedCount).toBe(2);
  });

  it('normalizes image MIME types from the extension when the picker type is empty', () => {
    expect(normalizeImageMimeType('shot.png', '')).toBe('image/png');
    expect(normalizeImageMimeType('shot.JPG', 'application/octet-stream')).toBe('image/jpeg');
    expect(normalizeImageMimeType('shot.svg', 'image/svg+xml')).toBe('image/svg+xml');
    expect(normalizeImageMimeType('readme.md', 'text/markdown')).toBe('text/markdown');
    expect(normalizeImageMimeType('blob.bin', '')).toBe('');
    expect(IMAGE_MIME_BY_EXTENSION.webp).toBe('image/webp');
  });

  it('ignores VCS, build, cache, IDE, virtualenv and secret files', () => {
    const result = scanTrustedFiles([
      file({ name: 'a.ts', webkitRelativePath: 'root/src/a.ts' }),
      file({ name: 'ignored.ts', webkitRelativePath: 'root/node_modules/pkg/ignored.ts' }),
      file({ name: 'out.js', webkitRelativePath: 'root/dist/out.js' }),
      file({ name: 'cache', webkitRelativePath: 'root/.git/cache' }),
      file({ name: 'x.ts', webkitRelativePath: 'root/__pycache__/x.ts' }),
      file({ name: 'key.pem', webkitRelativePath: 'root/secrets/key.pem' }),
      file({ name: '.env.local', webkitRelativePath: 'root/.env.local' }),
      file({ name: 'id_rsa', webkitRelativePath: 'root/.ssh/id_rsa' }),
      file({ name: '.DS_Store', webkitRelativePath: 'root/.DS_Store' }),
      file({ name: 'ok.ts', webkitRelativePath: 'root/src/ok.ts' }),
    ]);
    expect(result.files.map((item) => item.relativePath)).toEqual([
      'root/src/a.ts',
      'root/src/ok.ts',
    ]);
    expect(result.skippedCount).toBe(8);
  });

  it('skips oversized files and reports them as skipped', () => {
    const result = scanTrustedFiles([
      file({ name: 'small.ts', webkitRelativePath: 'root/small.ts' }),
      file({ name: 'huge.bin', webkitRelativePath: 'root/huge.bin', size: MAX_SINGLE_FILE_SIZE_BYTES + 1 }),
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('truncates at the file-count budget and keeps deterministic ordering', () => {
    const many = Array.from({ length: MAX_TRUSTED_FILES + 50 }, (_, index) =>
      file({ name: `f${index}.ts`, webkitRelativePath: `root/f${String(index).padStart(4, '0')}.ts` }),
    );
    const result = scanTrustedFiles(many);
    expect(result.files).toHaveLength(MAX_TRUSTED_FILES);
    expect(result.truncated).toBe(true);
  });

  it('truncates at the total-bytes budget', () => {
    const perFile = MAX_SINGLE_FILE_SIZE_BYTES;
    const count = Math.floor(MAX_TOTAL_INDEX_BYTES / perFile) + 1;
    const result = scanTrustedFiles(
      Array.from({ length: count }, (_, index) =>
        file({ name: `part${index}.bin`, webkitRelativePath: `root/part${index}.bin`, size: perFile }),
      ),
    );
    expect(result.files).toHaveLength(count - 1);
    expect(result.truncated).toBe(true);
  });

  it('counts kinds for panel summaries', () => {
    const result = scanTrustedFiles([
      file({ name: 'a.png', webkitRelativePath: 'root/a.png' }),
      file({ name: 'b.ts', webkitRelativePath: 'root/b.ts' }),
      file({ name: 'c.bin', webkitRelativePath: 'root/c.bin' }),
    ]);
    expect(countTrustedFilesByKind(result.files)).toEqual({ images: 1, text: 1, other: 1 });
  });
});

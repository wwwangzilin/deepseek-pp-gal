import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  DEFAULT_LOCAL_FILE_READ_CHARS,
  MAX_LOCAL_FILE_READ_CHARS,
  MAX_LOCAL_FILE_WRITE_BYTES,
} from './contracts.mjs';
import { formatBytes } from './logger.mjs';

export function createFileToolHandlers({ logLine }) {
  return [
    { name: 'local_file_stat', handle: createLocalFileStatResult },
    { name: 'local_file_read', handle: createLocalFileReadResult },
    { name: 'local_file_write', handle: args => createLocalFileWriteResult(args, logLine) },
  ];
}

function createLocalFileStatResult(args) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    return {
      content: [{ type: 'text', text: stat ? `Local path exists: ${resolvedPath}` : `Local path does not exist: ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: {
          path: resolvedPath,
          exists: Boolean(stat),
          isFile: stat?.isFile() === true,
          isDirectory: stat?.isDirectory() === true,
          sizeBytes: stat?.size ?? 0,
          modifiedAt: stat?.mtimeMs ?? null,
        },
      },
    };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

function createLocalFileReadResult(args) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');

  const start = typeof args?.start === 'number' && args.start >= 0 ? Math.floor(args.start) : 0;
  const maxChars = typeof args?.max_chars === 'number' && args.max_chars >= 1
    ? Math.min(Math.floor(args.max_chars), MAX_LOCAL_FILE_READ_CHARS)
    : DEFAULT_LOCAL_FILE_READ_CHARS;

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const stat = safeStat(resolvedPath);
    if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${resolvedPath}`);

    const { content, totalChars, charsRead } = readTextFileWindow(resolvedPath, start, maxChars);
    const nextStart = start + charsRead;
    return {
      content: [{ type: 'text', text: `Read ${content.length} characters from ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: {
          path: resolvedPath,
          content,
          start,
          nextStart,
          maxChars,
          totalChars,
          truncated: nextStart < totalChars,
        },
      },
    };
  } catch (error) {
    return toolError(errorMessage(error));
  }
}

function createLocalFileWriteResult(args, logLine) {
  const inputPath = typeof args?.path === 'string' ? args.path.trim() : '';
  if (!inputPath) return toolError('path is required and must be a non-empty string.');
  if (typeof args?.content !== 'string') return toolError('content is required and must be a string.');

  try {
    const resolvedPath = resolveLocalPath(inputPath);
    const content = args.content;
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_LOCAL_FILE_WRITE_BYTES) {
      logLine(`local_file_write REJECTED path=${resolvedPath} contentBytes=${contentBytes} limit=${MAX_LOCAL_FILE_WRITE_BYTES}`);
      throw new Error(
        `Content exceeds the local file write limit (${formatBytes(contentBytes)} > ${formatBytes(MAX_LOCAL_FILE_WRITE_BYTES)}). Write the file in chunks: send the first section now, then call local_file_write again with append=true for each remaining section.`,
      );
    }

    const append = args?.append === true;
    const createDirectories = args?.create_directories !== false;
    const parentDir = dirname(resolvedPath);
    if (createDirectories) mkdirSync(parentDir, { recursive: true });
    else if (!safeStat(parentDir)?.isDirectory()) throw new Error(`Parent directory does not exist: ${parentDir}`);

    writeFileSync(resolvedPath, content, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    const sizeAfter = safeStat(resolvedPath)?.size ?? null;
    const sizeMatch = sizeAfter === null ? false : (append ? sizeAfter >= contentBytes : sizeAfter === contentBytes);
    logLine(`local_file_write OK path=${resolvedPath} append=${append} bytesWritten=${contentBytes} sizeOnDisk=${sizeAfter} sizeMatch=${sizeMatch}`);

    return {
      content: [{ type: 'text', text: `${append ? 'Appended' : 'Wrote'} ${contentBytes} bytes to ${resolvedPath}` }],
      structuredContent: {
        ok: true,
        data: { path: resolvedPath, append, bytesWritten: contentBytes, sizeBytes: sizeAfter ?? contentBytes },
      },
    };
  } catch (error) {
    logLine(`local_file_write ERROR path=${inputPath} error=${errorMessage(error)}`);
    return toolError(errorMessage(error));
  }
}

export function resolveLocalPath(input) {
  const trimmed = input.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export function resolveUnderRoot(rootPath, relativePath) {
  const resolved = resolve(rootPath, relativePath);
  const rel = relative(rootPath, resolved);
  if (rel.startsWith('..') || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Path escapes local Skill root: ${relativePath}`);
  }
  return resolved;
}

export function readTextFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

// 按需字节读取字符窗口，避免整文件读入内存（根除 OOM）。
// 返回 { content: 窗口字符串(≤maxChars 字符), totalChars: 整文件字符数 }。
export function readTextFileWindow(filePath, startChar, maxChars) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile()) throw new Error(`Local file is not readable: ${filePath}`);
  const totalBytes = stat.size;
  if (totalBytes === 0) return { content: '', totalChars: 0, charsRead: 0 };

  const fd = openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;

    // 定位起始字节偏移（UTF-8 变长；带顺序续读缓存避免 O(N^2)）
    let bytePos = 0;
    let charPos = 0;
    const cached = readWindowPosCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && startChar >= cached.charPos) {
      bytePos = cached.bytePos;
      charPos = cached.charPos;
    }
    while (bytePos < totalBytes && charPos < startChar) {
      const want = Math.min(chunkSize, totalBytes - bytePos);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, bytePos);
      if (got === 0) break;
      const atEof = bytePos + got >= totalBytes;
      // 只扫实际读到的 got 字节：Buffer.alloc 为零填充，短读时尾部 0x00 会被误计为字符。
      const { bytes: consumed, chars: added } = scanUtf8Chars(buf.subarray(0, got), startChar - charPos, atEof);
      if (consumed === 0) break; // 纵深防御：字节指针不前进即终止，杜绝死循环
      charPos += added;
      // 统一用 consumed 前进：用 got 会跳过被回退的尾部不完整序列，令后续窗口全部错位。
      bytePos += consumed;
      if (charPos >= startChar) break;
    }
    if (charPos < startChar) {
      return { content: '', totalChars: getTotalCharCount(fd, totalBytes, filePath, stat), charsRead: 0 };
    }
    // 达上限时仅淘汰最旧条目（FIFO），避免一次性清空所有热缓存导致频繁全扫。
    if (readWindowPosCache.size >= MAX_WINDOW_POS_CACHE) {
      const oldest = readWindowPosCache.keys().next().value;
      if (oldest !== undefined) readWindowPosCache.delete(oldest);
    }
    readWindowPosCache.set(filePath, { bytePos, charPos, mtimeMs: stat.mtimeMs, size: stat.size });

    // 读取窗口 [startChar, startChar + maxChars)
    let remaining = maxChars;
    let charsRead = 0;
    const parts = [];
    while (bytePos < totalBytes && remaining > 0) {
      const want = Math.min(chunkSize, totalBytes - bytePos);
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, bytePos);
      if (got === 0) break;
      const atEof = bytePos + got >= totalBytes;
      // 同上：仅扫描实际读到的 got 字节，并在非 EOF 时回退尾部不完整多字节序列。
      const { bytes: consumed, chars: added } = scanUtf8Chars(buf.subarray(0, got), remaining, atEof);
      if (consumed === 0) break; // 纵深防御：字节指针不前进即终止，杜绝死循环
      parts.push(buf.subarray(0, consumed));
      remaining -= added;
      charsRead += added;
      bytePos += consumed;
    }
    const text = Buffer.concat(parts).toString('utf8');
    const windowChars = Array.from(text).slice(0, Math.max(0, maxChars));
    const windowContent = windowChars.join('');
    const totalChars = getTotalCharCount(fd, totalBytes, filePath, stat);
    return { content: windowContent, totalChars, charsRead: windowChars.length };
  } finally {
    closeSync(fd);
  }
}

// 扫描 buffer，返回"前 maxChars 个字符所占字节数"与"实际字符数"(可能因 buffer 不足 < maxChars)。
// 跨 buffer 的字符连续性由 UTF-8 字节前缀规则保证：续字节(0x80-0xBF)不计入字符数。
//
// atEof=true 表示本 buffer 末尾即文件末尾：尾部不完整序列属损坏数据，原样保留不静默丢弃。
// atEof=false 时必须回退尾部不完整的多字节序列。否则当某个字符的首字节恰好落在 buffer
// 最后一个字节时，内层 while 的 i < bytes.length 立即为假、续字节未被纳入，返回的 bytes
// 含一个孤立首字节，Buffer.concat().toString('utf8') 会将其解码为 U+FFFD；同时 bytePos
// 停在字符中间，导致后续所有窗口的起始位置错位。
function scanUtf8Chars(bytes, maxChars, atEof = false) {
  let i = 0;
  let chars = 0;
  while (i < bytes.length && chars < maxChars) {
    if ((bytes[i] & 0xC0) !== 0x80) {
      chars++;
      if (chars === maxChars) {
        i++;
        while (i < bytes.length && (bytes[i] & 0xC0) === 0x80) i++;
        break;
      }
    }
    i++;
  }
  if (atEof) return { bytes: i, chars };
  const rollback = incompleteTailBytes(bytes, i);
  return rollback > 0 ? { bytes: i - rollback, chars: chars - 1 } : { bytes: i, chars };
}

// 返回 bytes[0, end) 末尾"不完整多字节序列"所占字节数；序列完整时返回 0。
// UTF-8 单字符最长 4 字节，故最多回看 3 个续字节。
function incompleteTailBytes(bytes, end) {
  let k = end - 1;
  let continuation = 0;
  while (k >= 0 && continuation < 3 && (bytes[k] & 0xC0) === 0x80) {
    k--;
    continuation++;
  }
  if (k < 0) return 0;
  const lead = bytes[k];
  const need = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
  return continuation + 1 < need ? continuation + 1 : 0;
}

// 顺序续读定位缓存：记录 (path -> 已扫描到的字节/字符偏移)，使 auto 续读每窗只扫新增量。
// 上限保护（L1）：长驻宿主进程读取大量不同文件时避免 Map 无限增长导致内存泄漏。
const MAX_WINDOW_POS_CACHE = 1024;
const readWindowPosCache = new Map();
// 整文件字符数缓存（按 mtime+size 失效），避免每次调用全文件重扫。上限保护同 L1。
const MAX_FILE_CHAR_CACHE = 1024;
const fileCharCountCache = new Map();

function getTotalCharCount(fd, totalBytes, path, stat) {
  const cached = fileCharCountCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.count;
  let count = 0;
  let bytePos = 0;
  const chunkSize = 256 * 1024;
  const buf = Buffer.alloc(chunkSize);
  while (bytePos < totalBytes) {
    const want = Math.min(chunkSize, totalBytes - bytePos);
    const got = readSync(fd, buf, 0, want, bytePos);
    if (got === 0) break;
    for (let j = 0; j < got; j++) if ((buf[j] & 0xC0) !== 0x80) count++;
    bytePos += got;
  }
  // 达上限时仅淘汰最旧条目（FIFO），避免一次性清空所有热缓存导致频繁全扫。
  if (fileCharCountCache.size >= MAX_FILE_CHAR_CACHE) {
    const oldest = fileCharCountCache.keys().next().value;
    if (oldest !== undefined) fileCharCountCache.delete(oldest);
  }
  fileCharCountCache.set(path, { count, mtimeMs: stat.mtimeMs, size: stat.size });
  return count;
}

export function safeReadDirectory(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

export function safeStat(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function isMissingPathError(error) {
  return error && typeof error === 'object'
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

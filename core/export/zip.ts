import type { ConversationExportArtifact } from './types';

export interface ConversationExportArchiveArtifact {
  filename: string;
  mimeType: 'application/zip';
  content: Uint8Array;
}

interface StoredZipEntry {
  filename: string;
  content: Uint8Array;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const textEncoder = new TextEncoder();
const crc32Table = createCrc32Table();

/**
 * Builds a single store-only ZIP so one user gesture downloads every selected
 * export format. Browsers commonly block the second and later asynchronous
 * `<a download>` clicks as automatic multi-downloads (Issue #546).
 */
export function createConversationExportArchiveArtifact(
  artifacts: readonly ConversationExportArtifact[],
  modifiedAt = new Date(),
): ConversationExportArchiveArtifact {
  if (artifacts.length === 0) {
    throw new Error('Cannot create a conversation export archive without artifacts.');
  }

  const entries = artifacts.map((artifact) => ({
    filename: artifact.filename,
    content: textEncoder.encode(artifact.content),
  }));
  const firstStem = artifacts[0].filename.replace(/\.[^.]+$/, '') || 'deepseek-conversations-export';

  return {
    filename: `${firstStem}.zip`,
    mimeType: 'application/zip',
    content: createStoredZip(entries, modifiedAt),
  };
}

function createStoredZip(entries: readonly StoredZipEntry[], modifiedAt: Date): Uint8Array {
  if (entries.length > UINT16_MAX) throw new Error('ZIP entry count exceeds the supported limit.');
  const dos = toDosDateTime(modifiedAt);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const filename = textEncoder.encode(entry.filename);
    if (filename.length === 0 || filename.length > UINT16_MAX) {
      throw new Error('ZIP entry filename is empty or too long.');
    }
    if (entry.content.length > UINT32_MAX || localOffset > UINT32_MAX) {
      throw new Error('ZIP entry exceeds the supported 32-bit size limit.');
    }

    const checksum = crc32(entry.content);
    const localHeader = new Uint8Array(30 + filename.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, ZIP_LOCAL_FILE_HEADER, true);
    localView.setUint16(4, ZIP_VERSION, true);
    localView.setUint16(6, ZIP_UTF8_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dos.time, true);
    localView.setUint16(12, dos.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.content.length, true);
    localView.setUint32(22, entry.content.length, true);
    localView.setUint16(26, filename.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(filename, 30);
    localParts.push(localHeader, entry.content);

    const centralHeader = new Uint8Array(46 + filename.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, ZIP_CENTRAL_DIRECTORY_HEADER, true);
    centralView.setUint16(4, ZIP_VERSION, true);
    centralView.setUint16(6, ZIP_VERSION, true);
    centralView.setUint16(8, ZIP_UTF8_FLAG, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dos.time, true);
    centralView.setUint16(14, dos.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.content.length, true);
    centralView.setUint32(24, entry.content.length, true);
    centralView.setUint16(28, filename.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(filename, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.content.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (centralSize > UINT32_MAX || localOffset + centralSize > UINT32_MAX) {
    throw new Error('ZIP central directory exceeds the supported 32-bit size limit.');
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function toDosDateTime(value: Date): { date: number; time: number } {
  const valid = Number.isNaN(value.valueOf()) ? new Date(0) : value;
  const year = Math.max(1980, Math.min(2107, valid.getUTCFullYear()));
  const month = valid.getUTCMonth() + 1;
  const day = Math.max(1, valid.getUTCDate());
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (valid.getUTCHours() << 11) | (valid.getUTCMinutes() << 5) | (valid.getUTCSeconds() >> 1),
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = UINT32_MAX;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ UINT32_MAX) >>> 0;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

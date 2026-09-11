import type { GalCharacter, NewGalCharacter } from '../types';

/**
 * SillyTavern-compatible character card codec (PNG tEXt/iTXt `chara` payload).
 *
 * Cards are PNG files carrying a base64 JSON payload in a `chara` (V2) or
 * `ccv3` (V3) text chunk. We read V1/V2/V3 shapes and map them onto
 * GalCharacter; exporting writes a minimal PNG with the same payload so the
 * card can be imported by SillyTavern again.
 */

interface CharacterCardData {
  name?: unknown;
  description?: unknown;
  personality?: unknown;
  scenario?: unknown;
  first_mes?: unknown;
  mes_example?: unknown;
  creator_notes?: unknown;
  system_prompt?: unknown;
  post_history_instructions?: unknown;
  tags?: unknown;
  character_version?: unknown;
  extensions?: unknown;
}

export interface ParsedCharacterCard {
  character: NewGalCharacter;
  warnings: string[];
}

/** Reads a character card out of PNG bytes (returns null when no card chunk exists). */
export function parseCharacterCardFromPng(bytes: Uint8Array): ParsedCharacterCard | null {
  const payload = readCardPayload(bytes);
  if (!payload) return null;
  const json = decodeCardJson(payload.text);
  if (!json) return null;
  return mapCardToCharacter(json, payload.source);
}

/** Builds a PNG containing the SillyTavern V2 payload for this character. */
export function buildCharacterCardPng(
  character: GalCharacter,
  basePng?: Uint8Array | null,
): Uint8Array {
  const json = JSON.stringify(buildCardJson(character));
  const base64 = base64EncodeUtf8(json);
  if (basePng && basePng.length > 0) {
    const injected = injectTextChunk(basePng, 'chara', base64);
    if (injected) return injected;
  }
  return buildSolidCardPng(character.color || '#8f7bff', base64);
}

function readCardPayload(bytes: Uint8Array): { text: string; source: 'chara' | 'ccv3' } | null {
  if (bytes.length < 8) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let v3: string | null = null;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === 'tEXt' || type === 'iTXt') {
      const parsed = parseTextChunk(type, bytes, dataStart, length);
      if (parsed) {
        if (parsed.keyword === 'ccv3') v3 = parsed.text;
        else if (parsed.keyword === 'chara') return { text: parsed.text, source: 'chara' };
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return v3 ? { text: v3, source: 'ccv3' } : null;
}

function parseTextChunk(
  type: string,
  bytes: Uint8Array,
  start: number,
  length: number,
): { keyword: string; text: string } | null {
  if (type === 'tEXt') {
    const data = bytes.subarray(start, start + length);
    const nul = data.indexOf(0);
    if (nul <= 0) return null;
    return {
      keyword: readAscii(data, 0, nul),
      text: readAscii(data, nul + 1, data.length - nul - 1),
    };
  }
  // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) langTag \0 translated \0 text
  const data = bytes.subarray(start, start + length);
  const firstNul = data.indexOf(0);
  if (firstNul <= 0 || firstNul + 2 >= data.length) return null;
  const compressionFlag = data[firstNul + 1];
  if (compressionFlag !== 0) return null;
  let cursor = firstNul + 3;
  const langEnd = data.indexOf(0, cursor);
  if (langEnd < 0) return null;
  const translatedEnd = data.indexOf(0, langEnd + 1);
  if (translatedEnd < 0) return null;
  cursor = translatedEnd + 1;
  return {
    keyword: readAscii(data, 0, firstNul),
    text: utf8Decode(data.subarray(cursor)),
  };
}

function decodeCardJson(text: string): Record<string, unknown> | null {
  const candidates = [text, base64DecodeUtf8(text.trim())].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* try next */ }
  }
  return null;
}

function mapCardToCharacter(
  json: Record<string, unknown>,
  source: 'chara' | 'ccv3',
): ParsedCharacterCard {
  const warnings: string[] = [];
  const root = json;
  const nested = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : null;
  const data = (nested ?? root) as CharacterCardData;

  const name = stringOr(data.name, '').trim();
  if (!name) warnings.push('卡里没有角色名，已命名为「未命名角色」');
  const extensions = (data.extensions && typeof data.extensions === 'object')
    ? data.extensions as Record<string, unknown>
    : {};
  const gal = (extensions.gal && typeof extensions.gal === 'object')
    ? extensions.gal as Record<string, unknown>
    : {};

  const tags = arrayOfStrings(data.tags);
  const memoryTags = arrayOfStrings(gal.memoryTags);
  const greeting = stringOr(data.first_mes, '');
  const example = stringOr(data.mes_example, '');
  const systemPrompt = [
    stringOr(data.system_prompt, ''),
    stringOr(data.post_history_instructions, ''),
  ].filter(Boolean).join('\n\n');
  const description = [stringOr(data.description, ''), stringOr(data.creator_notes, '')]
    .filter(Boolean)
    .join('\n\n');

  const character: NewGalCharacter = {
    id: makeImportedId(),
    name: name || '未命名角色',
    color: stringOr(gal.color, '#8f7bff'),
    avatar: stringOr(gal.avatar, ''),
    description,
    personality: stringOr(data.personality, ''),
    scenario: stringOr(data.scenario, ''),
    exampleDialogue: example,
    greeting,
    systemPrompt,
    memoryTags: memoryTags.length > 0 ? memoryTags : tags,
    affinity: typeof gal.affinity === 'number' && Number.isFinite(gal.affinity)
      ? Math.max(0, Math.min(100, Math.round(gal.affinity)))
      : 0,
  };
  if (source === 'ccv3') warnings.push('读取自 V3（ccv3）卡');
  return { character, warnings };
}

function buildCardJson(character: GalCharacter): Record<string, unknown> {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.description ?? '',
      personality: character.personality ?? '',
      scenario: character.scenario ?? '',
      first_mes: character.greeting ?? '',
      mes_example: character.exampleDialogue ?? '',
      creator_notes: 'Exported from DeepSeek++ GAL',
      system_prompt: character.systemPrompt ?? '',
      post_history_instructions: '',
      tags: character.memoryTags ?? [],
      character_version: '1.0',
      extensions: {
        gal: {
          color: character.color ?? '#8f7bff',
          avatar: character.avatar ?? '',
          affinity: character.affinity ?? 0,
          memoryTags: character.memoryTags ?? [],
        },
      },
    },
  };
}

function buildSolidCardPng(color: string, base64Payload: string): Uint8Array {
  const [r, g, b] = parseHexColor(color);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1);
  ihdrView.setUint32(4, 1);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = new Uint8Array([0, r, g, b, 255]);
  const idat = zlibStored(raw);
  const chunks = [
    buildChunk('IHDR', ihdr),
    buildChunk('tEXt', concatBytes(asciiBytes('chara'), new Uint8Array([0]), asciiBytes(base64Payload))),
    buildChunk('IDAT', idat),
    buildChunk('IEND', new Uint8Array(0)),
  ];
  return concatBytes(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
  );
}

/** Injects/replaces a tEXt chunk in an existing PNG (used to keep the portrait). */
function injectTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array | null {
  if (png.length < 8) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let offset = 8;
  let injected = false;
  let sawIend = false;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = readAscii(png, offset + 4, 4);
    const end = offset + 8 + length + 4;
    if (end > png.length) return null;
    if (type === 'tEXt' || type === 'iTXt') {
      const parsed = parseTextChunk(type, png, offset + 8, length);
      if (parsed && (parsed.keyword === 'chara' || parsed.keyword === 'ccv3')) {
        offset = end;
        continue; // drop the old card chunk
      }
    }
    if (type === 'IEND') {
      if (!injected) {
        parts.push(buildChunk('tEXt', concatBytes(
          asciiBytes(keyword), new Uint8Array([0]), asciiBytes(text),
        )));
        injected = true;
      }
      parts.push(png.subarray(offset, end));
      sawIend = true;
      offset = end;
      break;
    }
    if (!injected && type === 'IDAT') {
      parts.push(buildChunk('tEXt', concatBytes(
        asciiBytes(keyword), new Uint8Array([0]), asciiBytes(text),
      )));
      injected = true;
    }
    parts.push(png.subarray(offset, end));
    offset = end;
  }
  if (!sawIend || !injected) return null;
  return concatBytes(...parts);
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = concatBytes(typeBytes, data);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

/** zlib stream with a single stored (uncompressed) deflate block. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const length = raw.length;
  const out = new Uint8Array(2 + 5 + length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out[2] = 0x01;               // BFINAL=1, BTYPE=00
  out[3] = length & 0xff;
  out[4] = (length >>> 8) & 0xff;
  out[5] = (~length) & 0xff;
  out[6] = ((~length) >>> 8) & 0xff;
  out.set(raw, 7);
  const adler = adler32(raw);
  const view = new DataView(out.buffer);
  view.setUint32(7 + length, adler);
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function parseHexColor(color: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return [143, 123, 255];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return readAscii(bytes, 0, bytes.length);
  }
}

function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(binary);
  return '';
}

function base64DecodeUtf8(text: string): string {
  if (!text || typeof atob !== 'function') return '';
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    return utf8Decode(bytes);
  } catch {
    return '';
  }
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function makeImportedId(): string {
  return 'char-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

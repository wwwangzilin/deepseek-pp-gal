import { createExportFilename } from './artifact-filename';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ConversationExportFailure,
  ExportedAttachment,
  ExportedMessage,
  ExportedSession,
} from './types';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const PAGE_MARGIN = 54;
const LINE_HEIGHT = 16;
const TITLE_FONT_SIZE = 22;
const BODY_FONT_SIZE = 11;
const MAX_TEXT_CHARS_PER_LINE = 54;
const MAX_META_CHARS_PER_LINE = 72;

interface PdfPage {
  lines: PdfLine[];
}

interface PdfLine {
  text: string;
  fontSize: number;
  leading?: number;
}

export function createConversationExportPdfArtifact(exportData: ConversationExport): ConversationExportArtifact {
  return {
    format: 'pdf',
    filename: createExportFilename(exportData, 'pdf'),
    mimeType: 'application/pdf',
    content: renderConversationExportPdf(exportData),
  };
}

export function renderConversationExportPdf(exportData: ConversationExport): string {
  const pages = paginateLines(buildPdfLines(exportData));
  return buildPdf(pages.length > 0 ? pages : [{ lines: [{ text: 'DeepSeek Conversation Export', fontSize: TITLE_FONT_SIZE }] }]);
}

function buildPdfLines(exportData: ConversationExport): PdfLine[] {
  const lines: PdfLine[] = [
    { text: 'DeepSeek Conversation Export', fontSize: TITLE_FONT_SIZE, leading: 24 },
    { text: `Export ID ${exportData.exportId}`, fontSize: BODY_FONT_SIZE },
    { text: `Created ${exportData.createdAt} · Mode ${exportData.request.mode}`, fontSize: BODY_FONT_SIZE, leading: 22 },
    { text: `Sessions ${exportData.stats.sessionCount} · Messages ${exportData.stats.messageCount} · Attachments ${exportData.stats.attachmentCount}`, fontSize: BODY_FONT_SIZE, leading: 24 },
  ];

  appendFailures(lines, exportData.failures);
  for (const session of exportData.sessions) {
    appendSession(lines, session, exportData.attachments);
  }
  if (exportData.attachments.length > 0) {
    lines.push({ text: 'Attachment Manifest', fontSize: 15, leading: 20 });
    for (const attachment of exportData.attachments) {
      appendWrapped(lines, renderAttachment(attachment), MAX_META_CHARS_PER_LINE);
    }
  }

  return lines;
}

function appendSession(lines: PdfLine[], session: ExportedSession, attachments: ExportedAttachment[]) {
  lines.push({ text: session.title, fontSize: 17, leading: 22 });
  appendWrapped(
    lines,
    `Session ${session.id} · Updated ${session.updatedAt ?? 'unknown'} · Model ${session.modelType ?? 'unknown'}`,
    MAX_META_CHARS_PER_LINE,
  );
  appendFailures(lines, session.failures);

  for (const message of session.messages) {
    lines.push({ text: `${message.role} · ${message.createdAt ?? message.id}`, fontSize: 13, leading: 18 });
    appendWrapped(lines, message.content || 'No text content', MAX_TEXT_CHARS_PER_LINE);
    for (const ref of message.attachmentRefs) {
      const attachment = attachments.find((item) => item.id === ref.id);
      appendWrapped(lines, `Attachment: ${attachment?.fileName ?? ref.id}`, MAX_META_CHARS_PER_LINE);
    }
    lines.push({ text: '', fontSize: BODY_FONT_SIZE, leading: 8 });
  }
}

function appendFailures(lines: PdfLine[], failures: ConversationExportFailure[]) {
  if (failures.length === 0) return;
  lines.push({ text: 'Export Warnings', fontSize: 13, leading: 18 });
  for (const failure of failures) {
    appendWrapped(lines, `${failure.code}: ${failure.message}`, MAX_META_CHARS_PER_LINE);
  }
}

function appendWrapped(lines: PdfLine[], text: string, maxChars: number) {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push({ text: '', fontSize: BODY_FONT_SIZE, leading: LINE_HEIGHT });
      continue;
    }
    for (const wrapped of wrapText(trimmed, maxChars)) {
      lines.push({ text: wrapped, fontSize: BODY_FONT_SIZE, leading: LINE_HEIGHT });
    }
  }
}

function wrapText(text: string, maxChars: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(''));
  }
  return lines;
}

function renderAttachment(attachment: ExportedAttachment): string {
  const parts = [
    attachment.fileName ?? attachment.id,
    `id=${attachment.id}`,
    `status=${attachment.status}`,
    attachment.sizeBytes === null ? null : `size=${attachment.sizeBytes}B`,
    attachment.mimeType ? `type=${attachment.mimeType}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join('; ');
}

function paginateLines(lines: PdfLine[]): PdfPage[] {
  const pages: PdfPage[] = [];
  let page: PdfPage = { lines: [] };
  let y = PAGE_HEIGHT - PAGE_MARGIN;

  for (const line of lines) {
    const leading = line.leading ?? LINE_HEIGHT;
    if (page.lines.length > 0 && y - leading < PAGE_MARGIN) {
      pages.push(page);
      page = { lines: [] };
      y = PAGE_HEIGHT - PAGE_MARGIN;
    }
    page.lines.push(line);
    y -= leading;
  }

  if (page.lines.length > 0) pages.push(page);
  return pages;
}

function buildPdf(pages: PdfPage[]): string {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = addObject('');
  const fontId = addObject('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>');
  addObject('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R >>');
  addObject('<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>');

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = addObject(createPageContentStream(page));
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const bodyParts = ['%PDF-1.4\n%\x7f\x7f\x7f\x7f\n'];
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(byteLength(bodyParts.join('')));
    bodyParts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  }
  const xrefOffset = byteLength(bodyParts.join(''));
  bodyParts.push(`xref\n0 ${objects.length + 1}\n`);
  bodyParts.push('0000000000 65535 f \n');
  for (let index = 1; index < offsets.length; index += 1) {
    bodyParts.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  }
  bodyParts.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return bodyParts.join('');
}

function createPageContentStream(page: PdfPage): string {
  const commands: string[] = ['BT'];
  let y = PAGE_HEIGHT - PAGE_MARGIN;
  for (const line of page.lines) {
    commands.push(`/F1 ${line.fontSize} Tf`);
    commands.push(`1 0 0 1 ${PAGE_MARGIN} ${Math.max(PAGE_MARGIN, y)} Tm`);
    commands.push(`${toPdfHexString(line.text)} Tj`);
    y -= line.leading ?? LINE_HEIGHT;
  }
  commands.push('ET');
  const stream = commands.join('\n');
  return `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
}

function toPdfHexString(text: string): string {
  const normalized = stripUnsupportedPdfCharacters(text);
  const bytes: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    bytes.push(code.toString(16).padStart(4, '0'));
  }
  return `<${bytes.join('')}>`;
}

function stripUnsupportedPdfCharacters(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0xfe0f) return '';
      if (code > 0xffff) return '';
      return char;
    })
    .join('');
}

function byteLength(text: string): number {
  return text.length;
}

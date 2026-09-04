import type { SavedItem } from '../saved-items';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ExportedAttachment,
} from './types';

export type SecondaryExportKind = 'saved_items' | 'image_manifest';
export type SecondaryExportFormat = 'markdown' | 'json' | 'html';

export interface SecondaryExportArtifact {
  kind: SecondaryExportKind;
  format: SecondaryExportFormat;
  filename: string;
  mimeType: string;
  content: string;
}

export function createSavedItemsMarkdownArtifact(items: readonly SavedItem[]): SecondaryExportArtifact {
  const lines = [
    '# DeepSeek++ Saved Items',
    '',
    `- Count: ${items.length}`,
    `- Exported: ${new Date().toISOString()}`,
    '',
  ];
  for (const item of items) {
    lines.push(
      `## ${stripMarkdownHeading(item.title)}`,
      '',
      `- Kind: ${item.kind}`,
      `- Tags: ${item.tags.length ? item.tags.join(', ') : 'none'}`,
      `- Updated: ${new Date(item.updatedAt).toISOString()}`,
      '',
      item.content,
      '',
    );
  }

  return {
    kind: 'saved_items',
    format: 'markdown',
    filename: `deepseek-saved-items-${new Date().toISOString().slice(0, 10)}.md`,
    mimeType: 'text/markdown;charset=utf-8',
    content: lines.join('\n').replace(/\n{3,}/g, '\n\n'),
  };
}

export function createSavedItemsJsonArtifact(items: readonly SavedItem[]): SecondaryExportArtifact {
  return {
    kind: 'saved_items',
    format: 'json',
    filename: `deepseek-saved-items-${new Date().toISOString().slice(0, 10)}.json`,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify({
      schemaVersion: 'deepseek-pp.saved-items-export.v1',
      exportedAt: new Date().toISOString(),
      items,
    }, null, 2),
  };
}

export function createImageAttachmentManifestArtifact(attachments: readonly ExportedAttachment[]): SecondaryExportArtifact {
  const images = attachments.filter((attachment) => attachment.mimeType?.startsWith('image/'));
  const rows = images.map((attachment) =>
    `<tr><td>${escapeHtml(attachment.fileName ?? attachment.id)}</td><td>${escapeHtml(attachment.id)}</td><td>${escapeHtml(attachment.mimeType ?? '')}</td><td>${attachment.sizeBytes ?? ''}</td></tr>`
  ).join('');

  return {
    kind: 'image_manifest',
    format: 'html',
    filename: `deepseek-image-manifest-${new Date().toISOString().slice(0, 10)}.html`,
    mimeType: 'text/html;charset=utf-8',
    content: `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Image Manifest</title></head><body><h1>DeepSeek Image Manifest</h1><p>${images.length} image attachments</p><table><thead><tr><th>Name</th><th>ID</th><th>Type</th><th>Bytes</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
  };
}

export function createConversationImageManifestArtifact(exportData: Pick<ConversationExport, 'attachments' | 'createdAt'>): ConversationExportArtifact {
  const artifact = createImageAttachmentManifestArtifact(exportData.attachments);
  return {
    format: 'image_manifest',
    filename: `deepseek-image-manifest-${exportData.createdAt.slice(0, 10)}.html`,
    mimeType: artifact.mimeType,
    content: artifact.content,
  };
}

function safeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'message';
}

function stripMarkdownHeading(value: string): string {
  return value.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim() || 'Untitled';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

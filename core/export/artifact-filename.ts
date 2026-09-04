import type { ConversationExport } from './types';

export function createExportFilename(exportData: ConversationExport, extension: string): string {
  const stamp = exportData.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  return `deepseek-conversations-${exportData.request.mode}-${stamp}.${extension}`;
}

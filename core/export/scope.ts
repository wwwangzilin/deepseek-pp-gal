import type {
  ConversationExport,
  ConversationExportContentScope,
  ExportedMessage,
  ExportedSession,
} from './types';

/**
 * Content-range projection for exported artifacts (#499).
 *
 * `full` keeps every message and fragment (tool calls, continuations,
 * reasoning, injected context) — the troubleshooting format. `input-output`
 * keeps the initial user input plus the final assistant answer, with reasoning and tool
 * fragments removed from the retained assistant message.
 */
export function applyConversationExportContentScope(
  exportData: ConversationExport,
  scope: ConversationExportContentScope,
): ConversationExport {
  if (scope === 'full') return exportData;

  const sessions: ExportedSession[] = exportData.sessions.map((session) => {
    const messages = projectInputOutputMessages(session.messages);
    return { ...session, messages };
  });
  const messageCount = sessions.reduce((total, session) => total + session.messages.length, 0);
  const retainedMessageIds = new Set(
    sessions.flatMap((session) => session.messages.map((message) => message.id)),
  );
  const retainedAttachmentIds = new Set(
    sessions.flatMap((session) => session.messages.flatMap((message) =>
      message.attachmentRefs.map((attachment) => attachment.id))),
  );
  const attachments = exportData.attachments
    .filter((attachment) => retainedAttachmentIds.has(attachment.id))
    .map((attachment) => ({
      ...attachment,
      sourceMessageIds: attachment.sourceMessageIds.filter((messageId) => retainedMessageIds.has(messageId)),
    }));

  return {
    ...exportData,
    request: { ...exportData.request, contentScope: scope },
    stats: { ...exportData.stats, messageCount, attachmentCount: attachments.length },
    sessions,
    attachments,
  };
}

function projectInputOutputMessages(messages: readonly ExportedMessage[]): ExportedMessage[] {
  // #499 explicitly defines this scope as the initial human input plus the
  // final assistant output. Inline-agent continuation/tool-result prompts are
  // persisted by DeepSeek as later `user` messages, so retaining every user
  // role reintroduced exactly the internal context this scope must remove.
  const initialInput = messages
    .filter((message) => message.role === 'user')
    .map((message) => projectTextFragments(message))
    .find((message): message is ExportedMessage => message !== null);

  const assistantMessages = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => projectTextFragments(message))
    .filter((message): message is ExportedMessage => message !== null);

  const finalOutput = assistantMessages[assistantMessages.length - 1];
  return [initialInput, finalOutput].filter((message): message is ExportedMessage => message !== undefined);
}

function projectTextFragments(message: ExportedMessage): ExportedMessage | null {
  const fragments = message.contentFragments.filter((fragment) => fragment.kind === 'text');
  const content = fragments.map((fragment) => fragment.text).join('\n\n').trim();
  if (!content.trim()) return null;
  return { ...message, content, contentFragments: fragments };
}

import type { InlineAgentTraceRecord } from './types';

export type InlineAgentModelBackend = 'web' | 'official-api';

/**
 * Returns the positive server response id of the final stored agent step.
 * Official-API turns have no DeepSeek page-chain id and synthetic/local ids
 * are deliberately rejected.
 */
export function getInlineAgentNativeHistoryResponseId(
  trace: InlineAgentTraceRecord,
): number | null {
  if (trace.status !== 'complete' || trace.steps.length === 0) return null;
  const lastStep = trace.steps.reduce((latest, step) =>
    step.index > latest.index ? step : latest,
  );
  const id = lastStep.responseMessageId;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isInlineAgentNativeHistoryBackedTrace(
  trace: InlineAgentTraceRecord,
): boolean {
  return getInlineAgentNativeHistoryResponseId(trace) !== null;
}

export function shouldReloadInlineAgentNativeHistory(input: {
  modelBackend: InlineAgentModelBackend;
  budgetPaused: boolean;
  finalText: string;
  trace: InlineAgentTraceRecord;
  visibleChatSessionId: string | null;
}): boolean {
  return (
    input.modelBackend === 'web' &&
    !input.budgetPaused &&
    input.finalText.trim().length > 0 &&
    input.visibleChatSessionId === input.trace.chatSessionId &&
    isInlineAgentNativeHistoryBackedTrace(input.trace)
  );
}

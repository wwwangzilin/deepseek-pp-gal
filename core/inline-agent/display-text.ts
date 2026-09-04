import {
  extractTaskCompleteSignal,
  stripDanglingLeadingPunctuation,
  TASK_COMPLETE_BLOCK_RE,
} from './prompt';
import { stripRetiredArtifactProtocolBlocks } from './retired-artifact';
import { stripToolCalls } from '../interceptor/tool-parser';
import type { ToolDescriptor } from '../types';

/**
 * Display-layer answer extraction (Issue #551, pivoted by UI review): the
 * user-facing answer is the FULL final-turn reply text with the internal
 * `<task_complete>` control block stripped. Real deliverables live in the
 * reply body — a summary-only split hid them inside a collapsed step — so the
 * answer area always renders the complete body, never folded or truncated.
 * The signal summary remains a fallback for runs whose pre-signal text is
 * empty, so a malformed completion never hides the answer.
 *
 * Kept out of {@link ./prompt} because that module is shared into the
 * sidepanel initial shell; this display-only logic is used exclusively by the
 * content-script renderer, so it lives in its own bundle slice.
 */
export function getInlineAgentAnswerText(text: string): string {
  const body = stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
  if (body) return body;
  return extractTaskCompleteSignal(text)?.summary.trim() ?? '';
}

/**
 * Display-layer process/step text: the model's working notes with the
 * internal `<task_complete>` control block removed entirely.
 */
export function getInlineAgentProcessText(text: string): string {
  return stripDanglingLeadingPunctuation(text.replace(TASK_COMPLETE_BLOCK_RE, '').trim());
}

// ---------------------------------------------------------------------------
// Artifact protocol retirement (Issue: drop the plugin artifact extension):
// the plugin no longer converts `<artifact_create>` / `<artifact_bundle_create>`
// XML into display shapes. The model delivers files as plain markdown fences
// (````html / xychart-beta …). At the stored RESPONSE boundary xychart
// shorthand is normalized to Mermaid, then DeepSeek owns the final chart cards and native
// copy/download/run code
// blocks, native preview panel).
//
// Retirement contract — no silent swallow: artifact XML that still arrives
// from in-flight sessions (learned model behavior) is a retired internal
// control protocol: it is stripped by {@link stripRetiredArtifactProtocolBlocks}
// BEFORE the ordinary tool-call strip, so it can never surface as raw protocol
// bytes. Stripping alone is not enough: the loop's nudge decision runs on the
// same stripped text, so a turn whose visible tail still promises a
// deliverable (e.g. "now creating a report for you" without anything
// renderable following) is nudged to re-deliver in a renderable form instead
// of ending on an empty promise. `stripRetiredArtifactProtocolBlocks` only
// ever removes artifact XML — fenced code blocks, plain text, and every other
// tool tag pass through byte-for-byte (covered by tests).
// ---------------------------------------------------------------------------

export const INLINE_AGENT_TRUNCATION_MARKER = '...[truncated]';

/**
 * Removes the trailing truncation suffix from a display text so two texts of
 * the same origin (one clamped, one complete) can be compared. The suffix is
 * the `...[truncated]` marker, and — for legacy persisted texts — a trailing
 * fence line that an old salvage conversion emitted inside a closed fence.
 * Iterated so `content\n````\n...[truncated]` and `content\n...[truncated]`
 * (unclosed clamp cut) both normalize to `content`.
 */
export function stripInlineAgentTruncationSuffix(text: string): string {
  let value = text.trimEnd();
  let changed = true;
  while (changed && value) {
    changed = false;
    if (value.endsWith(INLINE_AGENT_TRUNCATION_MARKER)) {
      value = value.slice(0, -INLINE_AGENT_TRUNCATION_MARKER.length).trimEnd();
      changed = true;
      continue;
    }
    const lastLineStart = value.lastIndexOf('\n') + 1;
    const lastLine = value.slice(lastLineStart);
    if (/^`{3,}$/.test(lastLine.trim())) {
      value = value.slice(0, lastLineStart).trimEnd();
      changed = true;
    }
  }
  return value;
}

/**
 * Resolve the user-facing final answer of a completed run from its two
 * candidate sources (Issue #551 follow-up): the loop's resolved final text
 * `finalAnswer` and the last step's rendered text `lastStepText` (the same
 * final turn as it was streamed). When one is a prefix of the other they
 * provably share an origin and the longer one is the complete reply — traces
 * persisted by older builds stored a summary/prefix as `finalText` while the
 * full reply (e.g. a generated HTML document) only survived in the last step.
 * Unrelated texts keep `finalAnswer` (budget notices, legacy summary-split
 * runs). `fromStep` tells the caller the step body IS the answer and may be
 * replaced without a further equality check.
 *
 * Both candidates may carry a `...[truncated]` clamp marker, so the prefix
 * comparison normalizes both sides with
 * {@link stripInlineAgentTruncationSuffix} first. That keeps the same-origin
 * detection working without ever treating unrelated texts as one.
 */
export function resolveInlineAgentAnswerText(
  finalAnswer: string,
  lastStepText: string,
): { answer: string; fromStep: boolean } {
  if (!lastStepText) return { answer: finalAnswer, fromStep: false };
  if (!finalAnswer) return { answer: lastStepText, fromStep: true };
  const normalizedAnswer = stripInlineAgentTruncationSuffix(finalAnswer);
  const normalizedStep = stripInlineAgentTruncationSuffix(lastStepText);
  if (normalizedStep === normalizedAnswer) return { answer: finalAnswer, fromStep: false };
  if (normalizedStep.startsWith(normalizedAnswer)) return { answer: lastStepText, fromStep: true };
  if (normalizedAnswer.startsWith(normalizedStep)) return { answer: finalAnswer, fromStep: false };
  return { answer: finalAnswer, fromStep: false };
}

/**
 * Single-line tool-entry parameter summary (Codex-style work log): the first
 * short string field from the tool call payload, so `web_search · weather`
 * reads like the command line the agent ran. Returns null when the payload
 * has no useful string field (the caller then falls back to the result
 * summary).
 */
const TOOL_PARAM_PRIORITY_FIELDS = [
  'query',
  'url',
  'filename',
  'path',
  'command',
  'id',
  'name',
  'title',
  'keyword',
  'message',
  'prompt',
  'expression',
  'code',
];
const TOOL_PARAM_SUMMARY_MAX_CHARS = 120;

export function summarizeInlineAgentToolParams(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of TOOL_PARAM_PRIORITY_FIELDS) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const clean = value.trim().replace(/\s+/g, ' ');
    if (clean.length <= TOOL_PARAM_SUMMARY_MAX_CHARS) return clean;
    return `${clean.slice(0, TOOL_PARAM_SUMMARY_MAX_CHARS)}…`;
  }
  return null;
}

/**
 * The user-facing final text: retired artifact-protocol XML stripped first
 * (control channel — see module header), then tool-call XML of the active
 * catalog, then the `<task_complete>` control block. The remaining markdown
 * body (plain fences) is what the native history renderer takes over on the
 * committed final web response.
 */
export function getInlineAgentDisplayFinalText(
  text: string,
  descriptors: readonly ToolDescriptor[],
): string {
  const withoutRetiredProtocol = stripRetiredArtifactProtocolBlocks(text);
  const withoutToolCalls = stripToolCalls(withoutRetiredProtocol, { descriptors });
  return getInlineAgentAnswerText(withoutToolCalls);
}

/**
 * Step bodies show the model's working notes with the retired artifact
 * protocol and tool-call XML removed and the internal `<task_complete>`
 * control block stripped.
 */
export function getInlineAgentDisplayStepText(
  text: string,
  descriptors: readonly ToolDescriptor[],
): string {
  const withoutRetiredProtocol = stripRetiredArtifactProtocolBlocks(text);
  const withoutToolCalls = stripToolCalls(withoutRetiredProtocol, { descriptors });
  return getInlineAgentProcessText(withoutToolCalls);
}

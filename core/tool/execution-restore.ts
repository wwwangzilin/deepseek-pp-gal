import type { JsonValue, ToolCardResult, ToolExecutionRecord } from '../types';

const DEFAULT_DETAIL_MAX_LENGTH = 4000;
const DEFAULT_OUTPUT_MAX_LENGTH = 8000;
const TRUNCATION_SUFFIX = '\n...[truncated]';

export interface ToolExecutionRestoreLimits {
  detailMaxLength?: number;
  outputMaxLength?: number;
}

export function sanitizeToolExecutionForRestoreStorage(
  execution: ToolExecutionRecord,
  limits: ToolExecutionRestoreLimits = {},
): ToolExecutionRecord {
  return {
    name: execution.name,
    provider: execution.provider,
    descriptorId: execution.descriptorId,
    result: sanitizeToolCardResultForRestoreStorage(execution.result, limits),
  };
}

export function normalizeRestoredToolExecution(execution: ToolExecutionRecord): ToolExecutionRecord {
  return {
    name: execution.name,
    provider: execution.provider,
    descriptorId: execution.descriptorId,
    result: normalizeRestoredToolCardResult(execution.result),
  };
}

export function normalizeRestoredToolCardResult(result: ToolCardResult): ToolCardResult {
  return {
    ...result,
    output: normalizeRestoredOutput(result.output),
  };
}

function sanitizeToolCardResultForRestoreStorage(
  result: ToolCardResult,
  limits: ToolExecutionRestoreLimits,
): ToolCardResult {
  const detailMaxLength = limits.detailMaxLength ?? DEFAULT_DETAIL_MAX_LENGTH;
  const outputMaxLength = limits.outputMaxLength ?? DEFAULT_OUTPUT_MAX_LENGTH;
  return {
    ...result,
    detail: clampText(result.detail, detailMaxLength),
    output: sanitizeOutputForStorage(result.output, outputMaxLength),
  };
}

function sanitizeOutputForStorage(output: JsonValue | undefined, maxLength: number): JsonValue | undefined {
  if (output === undefined) return undefined;

  const serialized = safeStringify(output);
  if (serialized.length <= maxLength) return output;
  return clampText(serialized, maxLength);
}

function normalizeRestoredOutput(output: JsonValue | undefined): JsonValue | undefined {
  if (typeof output !== 'string') return output;

  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return output;

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    return isKnownStructuredToolOutput(parsed) ? parsed : output;
  } catch {
    return output;
  }
}

function isKnownStructuredToolOutput(value: JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const kind = value.kind;
  return kind === 'artifact' || kind === 'skill_draft' || kind === 'memory_import_preview';
}

function safeStringify(value: JsonValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}${TRUNCATION_SUFFIX}` : value;
}

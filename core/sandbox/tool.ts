import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import type { ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../tool/types';
import type { SandboxLanguage, SandboxRunRequest } from './types';

export const SANDBOX_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'sandbox',
  displayName: 'Browser Sandbox',
  transport: 'in_process',
};

export const SANDBOX_TOOL_NAMES = ['sandbox_run'] as const;
export type SandboxToolName = typeof SANDBOX_TOOL_NAMES[number];

export interface SandboxToolRuntime {
  runSandbox(request: SandboxRunRequest): Promise<ToolResult>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const PYTHON_DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CODE_BYTES = 30_000;
const MAX_INPUT_BYTES = 512 * 1024;

export function isSandboxToolName(name: string): name is SandboxToolName {
  return (SANDBOX_TOOL_NAMES as readonly string[]).includes(name);
}

export function createSandboxToolDescriptors(locale: SupportedLocale = DEFAULT_LOCALE): ToolDescriptor[] {
  return [{
    id: 'local:sandbox:sandbox_run',
    provider: SANDBOX_TOOL_PROVIDER,
    name: 'sandbox_run',
    invocationName: 'sandbox_run',
    title: translate(locale, 'tool.sandbox.runTitle'),
    description: translate(locale, 'tool.sandbox.runDescription'),
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'python', 'html'],
          description: translate(locale, 'tool.sandbox.languageDescription'),
        },
        code: { type: 'string', description: translate(locale, 'tool.sandbox.codeDescription') },
        input: { type: 'string', description: translate(locale, 'tool.sandbox.inputDescription') },
        timeoutMs: { type: 'integer', description: translate(locale, 'tool.sandbox.timeoutDescription') },
      },
      required: ['language', 'code'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'high', maxResultBytes: 4096 },
  }];
}

export async function executeSandboxToolCall(
  runtime: SandboxToolRuntime | null | undefined,
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  if (!isSandboxToolName(call.name)) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? SANDBOX_TOOL_PROVIDER,
      summary: translate(locale, 'tool.runtime.unknownTool'),
      error: {
        code: 'sandbox_tool_unsupported',
        message: `Unsupported sandbox tool: ${call.name}`,
        retryable: false,
      },
    };
  }

  try {
    const request = normalizeSandboxRunRequest(call.payload);
    if (!runtime) {
      return {
        ok: false,
        name: call.name,
        provider: call.provider ?? SANDBOX_TOOL_PROVIDER,
        summary: translate(locale, 'tool.sandbox.offscreenUnavailable'),
        detail: translate(locale, 'tool.sandbox.runtimeUnavailableDetail'),
        error: {
          code: 'sandbox_runtime_unavailable',
          message: 'Browser sandbox runtime is unavailable in this context.',
          retryable: false,
        },
      };
    }
    const result = await runtime.runSandbox(request);
    return {
      ...result,
      name: result.name ?? call.name,
      provider: result.provider ?? call.provider ?? SANDBOX_TOOL_PROVIDER,
      descriptorId: result.descriptorId ?? call.descriptorId,
    };
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? SANDBOX_TOOL_PROVIDER,
      summary: translate(locale, 'tool.sandbox.invalidRequest'),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'sandbox_invalid_request',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

export function normalizeSandboxRunRequest(value: unknown): SandboxRunRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('sandbox payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  const language = normalizeLanguage(payload.language);
  const code = requiredString(payload.code, 'code');
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) {
    throw new Error(`code is too large; max ${MAX_CODE_BYTES} bytes`);
  }
  const input = typeof payload.input === 'string' ? payload.input : undefined;
  if (input !== undefined && new TextEncoder().encode(input).length > MAX_INPUT_BYTES) {
    throw new Error(`input is too large; max ${MAX_INPUT_BYTES} bytes`);
  }
  return {
    language,
    code,
    input,
    timeoutMs: clampTimeout(payload.timeoutMs, language),
  };
}

function normalizeLanguage(value: unknown): SandboxLanguage {
  if (value === 'javascript' || value === 'typescript' || value === 'python' || value === 'html') return value;
  throw new Error('language must be javascript, typescript, python, or html');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function clampTimeout(value: unknown, language: SandboxLanguage): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return language === 'python' ? PYTHON_DEFAULT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  }
  return Math.min(15_000, Math.max(1_000, Math.floor(value)));
}

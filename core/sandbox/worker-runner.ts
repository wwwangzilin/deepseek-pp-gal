import { transform } from 'sucrase';
import type { SandboxExecutionResult, SandboxLanguage } from './types';
import PythonWorker from './python-worker?worker&inline';

const WORKER_OUTPUT_LIMIT = 12_000;

export function canRunWorkerSandbox(language: SandboxLanguage): boolean {
  return (language === 'javascript' || language === 'typescript' || language === 'python') &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined';
}

export function runWorkerSandbox(input: {
  language: SandboxLanguage;
  code: string;
  userInput?: string;
  timeoutMs: number;
  pyodideBaseUrl?: string;
}): Promise<SandboxExecutionResult> {
  if (!canRunWorkerSandbox(input.language)) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: '',
      durationMs: 0,
      truncated: false,
      error: `${input.language} sandbox is not available in this context`,
    });
  }
  if (input.language === 'python') return runPythonWorkerSandbox(input);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const workerUrl = URL.createObjectURL(new Blob([createWorkerSource()], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    let settled = false;

    const settle = (result: Omit<SandboxExecutionResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      settle({
        ok: false,
        stdout: '',
        stderr: 'Sandbox execution timed out.',
        truncated: false,
        error: 'sandbox_timeout',
      });
    }, input.timeoutMs);

    worker.onmessage = (event) => {
      settle(normalizeWorkerResult(event.data));
    };
    worker.onerror = (event) => {
      settle({
        ok: false,
        stdout: '',
        stderr: event.message,
        truncated: false,
        error: 'sandbox_worker_error',
      });
    };

    worker.postMessage({
      code: input.language === 'typescript' ? transpileTypeScript(input.code) : input.code,
      input: input.userInput ?? '',
      outputLimit: WORKER_OUTPUT_LIMIT,
    });
  });
}

function runPythonWorkerSandbox(input: {
  language: SandboxLanguage;
  code: string;
  userInput?: string;
  timeoutMs: number;
  pyodideBaseUrl?: string;
}): Promise<SandboxExecutionResult> {
  if (!input.pyodideBaseUrl) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: 'Pyodide runtime assets are unavailable.',
      durationMs: 0,
      truncated: false,
      error: 'sandbox_pyodide_assets_unavailable',
    });
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const worker = new PythonWorker();
    let settled = false;

    const settle = (result: Omit<SandboxExecutionResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      settle({
        ok: false,
        stdout: '',
        stderr: 'Python sandbox execution timed out.',
        truncated: false,
        error: 'sandbox_timeout',
      });
    }, input.timeoutMs);

    worker.onmessage = (event) => {
      settle(normalizeWorkerResult(event.data));
    };
    worker.onerror = (event) => {
      settle({
        ok: false,
        stdout: '',
        stderr: event.message,
        truncated: false,
        error: 'sandbox_pyodide_worker_error',
      });
    };

    worker.postMessage({
      code: input.code,
      input: input.userInput ?? '',
      outputLimit: WORKER_OUTPUT_LIMIT,
      pyodideBaseUrl: input.pyodideBaseUrl,
    });
  });
}

function normalizeWorkerResult(value: unknown): Omit<SandboxExecutionResult, 'durationMs'> {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      stdout: '',
      stderr: 'Invalid sandbox worker result.',
      truncated: false,
      error: 'sandbox_invalid_result',
    };
  }
  const result = value as Partial<SandboxExecutionResult>;
  // Hard caps on every string field regardless of envelope provenance: user
  // code inside the worker can self.postMessage a fabricated envelope, so the
  // receiver must not trust the worker-side truncation (H2).
  const stdout = limitText(typeof result.stdout === 'string' ? result.stdout : '', WORKER_RESULT_MAX_CHARS);
  const stderr = limitText(typeof result.stderr === 'string' ? result.stderr : '', WORKER_STDERR_MAX_CHARS);
  const rawResult = typeof result.result === 'string' ? result.result : undefined;
  const resultText = limitText(rawResult ?? '', WORKER_RESULT_MAX_CHARS);
  return {
    ok: result.ok === true,
    stdout: stdout.text,
    stderr: stderr.text,
    result: rawResult === undefined ? undefined : resultText.text,
    truncated: result.truncated === true || stdout.truncated || stderr.truncated || resultText.truncated,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

const WORKER_RESULT_MAX_CHARS = 512 * 1024;
const WORKER_STDERR_MAX_CHARS = 64 * 1024;

function limitText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...[truncated]`, truncated: true };
}

function transpileTypeScript(code: string): string {
  return transform(code, {
    transforms: ['typescript'],
    disableESTransforms: true,
    production: true,
  }).code;
}

function createWorkerSource(): string {
  return `
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const WORKER_RESULT_MAX_CHARS = 512 * 1024;
const WORKER_STDERR_MAX_CHARS = 64 * 1024;
self.onmessage = async (event) => {
  const { code, input, outputLimit } = event.data || {};
  const logs = [];
  const push = (level, values) => {
    const line = '[' + level + '] ' + values.map(formatValue).join(' ');
    logs.push(line);
  };
  const consoleProxy = {
    log: (...values) => push('log', values),
    info: (...values) => push('info', values),
    warn: (...values) => push('warn', values),
    error: (...values) => push('error', values),
  };
  try {
    const fn = new AsyncFunction('input', 'console', '"use strict";\\n' + String(code));
    const result = await fn(input, consoleProxy);
    const stdout = limitText(logs.join('\\n'), outputLimit);
    const resultText = limitText(formatValue(result), WORKER_RESULT_MAX_CHARS);
    self.postMessage({ ok: true, stdout: stdout.text, stderr: '', result: resultText.text, truncated: stdout.truncated || resultText.truncated });
  } catch (error) {
    const stdout = limitText(logs.join('\\n'), outputLimit);
    const stderr = limitText(error && error.stack ? String(error.stack) : String(error), WORKER_STDERR_MAX_CHARS);
    self.postMessage({
      ok: false,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      error: 'sandbox_exception',
    });
  }
};
function formatValue(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
function limitText(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + '\\n...[truncated]', truncated: true };
}
`;
}

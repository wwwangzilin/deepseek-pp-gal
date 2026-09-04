import { loadPyodide } from 'pyodide';

type PythonWorkerRequest = {
  code?: unknown;
  input?: unknown;
  outputLimit?: unknown;
  pyodideBaseUrl?: unknown;
};

type PyodideRuntime = Awaited<ReturnType<typeof loadPyodide>>;

let pyodidePromise: Promise<PyodideRuntime> | null = null;

self.onmessage = async (event: MessageEvent<PythonWorkerRequest>) => {
  const { code, input, outputLimit, pyodideBaseUrl } = event.data || {};
  const limit = typeof outputLimit === 'number' && Number.isFinite(outputLimit) ? outputLimit : 12_000;
  const stdin = typeof input === 'string' ? input : '';
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  try {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('Python sandbox code must be a non-empty string.');
    }
    if (typeof pyodideBaseUrl !== 'string' || pyodideBaseUrl.length === 0) {
      throw new Error('Pyodide asset base URL is missing.');
    }

    const pyodide = await getPyodide(pyodideBaseUrl);
    pyodide.setStdin({ stdin: () => stdin || null });
    pyodide.setStdout({ batched: (text) => { if (text) stdoutLines.push(String(text)); } });
    pyodide.setStderr({ batched: (text) => { if (text) stderrLines.push(String(text)); } });

    const result = await pyodide.runPythonAsync(code);
    const stdout = limitText(stdoutLines.join('\n'), limit);
    const stderr = limitText(stderrLines.join('\n'), limit);
    const resultText = limitText(formatPythonValue(result), PYTHON_RESULT_MAX_CHARS);
    postMessage({
      ok: true,
      stdout: stdout.text,
      stderr: stderr.text,
      result: resultText.text,
      truncated: stdout.truncated || stderr.truncated || resultText.truncated,
    });
    if (result && typeof result === 'object' && 'destroy' in result && typeof result.destroy === 'function') {
      result.destroy();
    }
  } catch (error) {
    const stdout = limitText(stdoutLines.join('\n'), limit);
    const stderr = limitText([
      stderrLines.join('\n'),
      error instanceof Error && error.stack ? error.stack : String(error),
    ].filter(Boolean).join('\n'), limit);
    postMessage({
      ok: false,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      error: 'sandbox_python_exception',
    });
  }
};

function getPyodide(pyodideBaseUrl: string): Promise<PyodideRuntime> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({
      indexURL: pyodideBaseUrl,
      packageBaseUrl: pyodideBaseUrl,
    });
  }
  return pyodidePromise;
}

function formatPythonValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    if (value && typeof value === 'object' && 'toJs' in value && typeof value.toJs === 'function') {
      return JSON.stringify(value.toJs());
    }
  } catch {
    // Fall through to String(value).
  }
  try { return String(value); } catch { return Object.prototype.toString.call(value); }
}

function limitText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...[truncated]`, truncated: true };
}

const PYTHON_RESULT_MAX_CHARS = 512 * 1024;

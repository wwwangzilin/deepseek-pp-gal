export type SandboxLanguage = 'javascript' | 'typescript' | 'python' | 'html';

export interface SandboxRunRequest {
  language: SandboxLanguage;
  code: string;
  input?: string;
  timeoutMs: number;
}

export interface SandboxExecutionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  html?: string;
  previewText?: string;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

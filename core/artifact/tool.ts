import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import type { JsonValue, ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../tool/types';
import { saveArtifact } from './store';
import type { ArtifactFile, ArtifactOutput, ArtifactPreviewMode, ArtifactRuntimeLanguage, ArtifactView } from './types';
import { bytesToBase64, createStoredZip } from './zip';

export const ARTIFACT_TOOL_PROVIDER: ToolProviderIdentity = {
  kind: 'local',
  id: 'artifact',
  displayName: 'Artifacts',
  transport: 'in_process',
};

export const ARTIFACT_TOOL_NAMES = ['artifact_create', 'artifact_bundle_create'] as const;

export type ArtifactToolName = typeof ARTIFACT_TOOL_NAMES[number];

export function isArtifactToolName(name: string): name is ArtifactToolName {
  return (ARTIFACT_TOOL_NAMES as readonly string[]).includes(name);
}

export function createArtifactToolDescriptors(_locale: SupportedLocale = DEFAULT_LOCALE): ToolDescriptor[] {
  return [
    {
      id: 'local:artifact:artifact_create',
      provider: ARTIFACT_TOOL_PROVIDER,
      name: 'artifact_create',
      invocationName: 'artifact_create',
      title: translate(_locale, 'tool.artifact.createTitle'),
      description: translate(_locale, 'tool.artifact.createDescription'),
      inputSchema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: translate(_locale, 'tool.artifact.filenameDescription') },
          content: { type: 'string', description: translate(_locale, 'tool.artifact.contentDescription') },
          mimeType: { type: 'string', description: translate(_locale, 'tool.artifact.mimeTypeDescription') },
          previewMode: {
            type: 'string',
            enum: ['auto', 'none', 'html', 'code'],
            description: translate(_locale, 'tool.artifact.previewModeDescription'),
          },
          language: {
            type: 'string',
            enum: ['html', 'javascript', 'typescript', 'python', 'text'],
            description: translate(_locale, 'tool.artifact.languageDescription'),
          },
        },
        required: ['filename', 'content'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'low', maxResultBytes: 4096 },
    },
    {
      id: 'local:artifact:artifact_bundle_create',
      provider: ARTIFACT_TOOL_PROVIDER,
      name: 'artifact_bundle_create',
      invocationName: 'artifact_bundle_create',
      title: translate(_locale, 'tool.artifact.bundleTitle'),
      description: translate(_locale, 'tool.artifact.bundleDescription'),
      inputSchema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: translate(_locale, 'tool.artifact.bundleFilenameDescription') },
          files: {
            type: 'array',
            description: translate(_locale, 'tool.artifact.filesDescription'),
          },
        },
        required: ['filename', 'files'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'medium', maxResultBytes: 4096 },
    },
  ];
}

export async function executeArtifactToolCall(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): Promise<ToolResult> {
  try {
    if (call.name === 'artifact_create') return await createSingleFile(call, locale);
    if (call.name === 'artifact_bundle_create') return await createBundle(call, locale);
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.artifact.failed'),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'artifact_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }

  return {
    ok: false,
    name: call.name,
    provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
    summary: translate(locale, 'tool.runtime.unknownTool'),
    error: {
      code: 'artifact_tool_unsupported',
      message: `Unsupported artifact tool: ${call.name}`,
      retryable: false,
    },
  };
}

export function createRestoredArtifactToolResult(
  call: ToolCall,
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolResult | null {
  if (!isArtifactToolName(call.name)) return null;

  try {
    if (call.name === 'artifact_create') {
      const artifact = normalizeSingleFileArtifact(call.payload);
      const output: ArtifactOutput = {
        kind: 'artifact',
        artifactId: createTransientArtifactId(artifact.filename, artifact.content),
        artifactKind: 'file',
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        view: artifact.view,
        transientContent: artifact.content,
      };
      return {
        ok: true,
        name: call.name,
        provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
        summary: translate(locale, 'tool.artifact.fileReady'),
        detail: `${artifact.filename} (${artifact.sizeBytes} bytes)`,
        output: output as unknown as JsonValue,
      };
    }

    const artifact = normalizeBundleArtifact(call.payload);
    const output: ArtifactOutput = {
      kind: 'artifact',
      artifactId: createTransientArtifactId(artifact.filename, artifact.content),
      artifactKind: 'bundle',
      filename: artifact.filename,
      mimeType: 'application/zip',
      sizeBytes: artifact.sizeBytes,
      fileCount: artifact.fileCount,
      transientContent: artifact.content,
    };
    return {
      ok: true,
      name: call.name,
      provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.artifact.bundleReady'),
      detail: `${artifact.filename} (${artifact.fileCount} files, ${artifact.sizeBytes} bytes)`,
      output: output as unknown as JsonValue,
    };
  } catch (error) {
    return {
      ok: false,
      name: call.name,
      provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
      summary: translate(locale, 'tool.artifact.failed'),
      detail: error instanceof Error ? error.message : String(error),
      error: {
        code: 'artifact_restore_failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

async function createSingleFile(call: ToolCall, locale: SupportedLocale): Promise<ToolResult> {
  const artifact = normalizeSingleFileArtifact(call.payload);
  const record = await saveArtifact({
    kind: 'file',
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    content: artifact.content,
    view: artifact.view,
  });
  const output: ArtifactOutput = {
    kind: 'artifact',
    artifactId: record.id,
    artifactKind: 'file',
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    sizeBytes: record.sizeBytes,
    view: artifact.view,
  };
  return {
    ok: true,
    name: call.name,
    provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
    summary: translate(locale, 'tool.artifact.fileReady'),
    detail: `${artifact.filename} (${record.sizeBytes} bytes)`,
    output: output as unknown as JsonValue,
  };
}

async function createBundle(call: ToolCall, locale: SupportedLocale): Promise<ToolResult> {
  const artifact = normalizeBundleArtifact(call.payload);
  const record = await saveArtifact({
    kind: 'bundle',
    filename: artifact.filename,
    mimeType: 'application/zip',
    content: artifact.content,
    files: artifact.files,
  });
  const output: ArtifactOutput = {
    kind: 'artifact',
    artifactId: record.id,
    artifactKind: 'bundle',
    filename: artifact.filename,
    mimeType: 'application/zip',
    sizeBytes: artifact.sizeBytes,
    fileCount: artifact.fileCount,
  };
  return {
    ok: true,
    name: call.name,
    provider: call.provider ?? ARTIFACT_TOOL_PROVIDER,
    summary: translate(locale, 'tool.artifact.bundleReady'),
    detail: `${artifact.filename} (${artifact.fileCount} files, ${artifact.sizeBytes} bytes)`,
    output: output as unknown as JsonValue,
  };
}

function normalizeSingleFileArtifact(payload: Record<string, unknown>): {
  filename: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
  view: ArtifactView;
} {
  const filename = safeFilename(payload.filename, 'artifact.txt');
  const content = requiredString(payload.content, 'content');
  const mimeType = optionalString(payload.mimeType) || inferMimeType(filename);
  return {
    filename,
    content,
    mimeType,
    sizeBytes: new TextEncoder().encode(content).length,
    view: normalizeArtifactView(payload, filename, mimeType),
  };
}

function normalizeBundleArtifact(payload: Record<string, unknown>): {
  filename: string;
  files: ArtifactFile[];
  content: string;
  sizeBytes: number;
  fileCount: number;
} {
  const filename = ensureZipFilename(safeFilename(payload.filename, 'project.zip'));
  const files = normalizeArtifactFiles(payload.files);
  const zipBytes = createStoredZip(files);
  return {
    filename,
    files,
    content: bytesToBase64(zipBytes),
    sizeBytes: zipBytes.length,
    fileCount: files.length,
  };
}

function createTransientArtifactId(filename: string, content: string): string {
  return `transient:${hashString(`${filename}\n${content}`)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeArtifactFiles(value: unknown): ArtifactFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('files must be a non-empty array');
  }
  return value.slice(0, 100).map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`files[${index}] must be an object`);
    const file = item as Record<string, unknown>;
    return {
      path: safeFilename(file.path, `file-${index + 1}.txt`),
      content: requiredString(file.content, `files[${index}].content`),
      mimeType: optionalString(file.mimeType),
    };
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeArtifactView(payload: Record<string, unknown>, filename: string, mimeType: string): ArtifactView {
  const language = normalizeArtifactLanguage(payload.language, filename, mimeType);
  const previewMode = normalizeArtifactPreviewMode(payload.previewMode, language);
  return { previewMode, language };
}

function normalizeArtifactPreviewMode(value: unknown, language: ArtifactRuntimeLanguage): ArtifactPreviewMode {
  if (value === 'none' || value === 'html' || value === 'code') return value;
  if (value !== undefined && value !== 'auto') {
    throw new Error('previewMode must be auto, none, html, or code');
  }
  if (language === 'html') return 'html';
  if (language === 'javascript' || language === 'typescript' || language === 'python') return 'code';
  return 'none';
}

function normalizeArtifactLanguage(value: unknown, filename: string, mimeType: string): ArtifactRuntimeLanguage {
  if (value === 'html' || value === 'javascript' || value === 'typescript' || value === 'python' || value === 'text') return value;
  if (value !== undefined) throw new Error('language must be html, javascript, typescript, python, or text');
  return inferArtifactLanguage(filename, mimeType);
}

function inferArtifactLanguage(filename: string, mimeType: string): ArtifactRuntimeLanguage {
  const lower = filename.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('html') || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (normalizedMimeType.includes('javascript') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.ts')) return 'typescript';
  if (normalizedMimeType.includes('python') || lower.endsWith('.py')) return 'python';
  return 'text';
}

function safeFilename(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  if (!normalized) return fallback;
  return normalized.slice(0, 180);
}

function ensureZipFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.zip') ? filename : `${filename}.zip`;
}

function inferMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js')) return 'text/javascript';
  if (lower.endsWith('.ts')) return 'text/typescript';
  if (lower.endsWith('.py')) return 'text/x-python';
  return 'text/plain';
}

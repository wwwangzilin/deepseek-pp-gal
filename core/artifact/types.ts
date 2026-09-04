export const ARTIFACT_SCHEMA_VERSION = 1 as const;

export type ArtifactKind = 'file' | 'bundle';

export interface ArtifactFile {
  path: string;
  content: string;
  mimeType?: string;
}

export type ArtifactPreviewMode = 'none' | 'html' | 'code';
export type ArtifactRuntimeLanguage = 'html' | 'javascript' | 'typescript' | 'python' | 'text';

export interface ArtifactView {
  previewMode: ArtifactPreviewMode;
  language: ArtifactRuntimeLanguage;
}

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  filename: string;
  mimeType: string;
  content: string;
  sizeBytes: number;
  createdAt: number;
  files?: ArtifactFile[];
  view?: ArtifactView;
}

export interface ArtifactOutput {
  kind: 'artifact';
  artifactId: string;
  artifactKind: ArtifactKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fileCount?: number;
  view?: ArtifactView;
  /**
   * Used only when restoring a historical tool call whose persisted artifact id
   * is unavailable. Preview/download can read this transient content directly.
   */
  transientContent?: string;
}

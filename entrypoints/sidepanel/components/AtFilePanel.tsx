import { useMemo } from 'react';
import { searchTrustedFiles } from '../../../core/trusted-directory/at-panel';
import { useI18n } from '../i18n';
import type { TrustedDirectorySession, TrustedDirectorySessionFile } from '../trusted-directory';

export type AtAttachmentStatus = 'uploading' | 'ready' | 'error';

export interface AtFilePanelProps {
  open: boolean;
  query: string;
  session: TrustedDirectorySession | null;
  statusByPath: ReadonlyMap<string, AtAttachmentStatus>;
  onToggleFile: (file: TrustedDirectorySessionFile) => void;
  onClose: () => void;
}

/**
 * #475 P1: the @ reference panel above the chat composer. Only images are
 * actionable today (they flow into the existing vision/ref_file_ids chain);
 * text files are greyed out pending the DeepSeek-side text channel (P2).
 */
export default function AtFilePanel({
  open,
  query,
  session,
  statusByPath,
  onToggleFile,
  onClose,
}: AtFilePanelProps) {
  const { t } = useI18n();

  const results = useMemo(
    () => (session ? searchTrustedFiles(session.files, query) : []),
    [session, query],
  );
  const sessionFileByPath = useMemo(() => {
    const map = new Map<string, TrustedDirectorySessionFile>();
    for (const file of session?.files ?? []) map.set(file.relativePath, file);
    return map;
  }, [session]);

  if (!open) return null;

  const renderEmpty = () => {
    if (!session) {
      return (
        <div className="ds-chat-at-empty" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.chatPage.atPanelNoDirectory')}
        </div>
      );
    }
    if (session.files.length === 0) {
      return (
        <div className="ds-chat-at-empty" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.chatPage.atPanelEmptyDirectory')}
        </div>
      );
    }
    return (
      <div className="ds-chat-at-empty" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.chatPage.atPanelNoMatch')}
      </div>
    );
  };

  return (
    <div className="ds-chat-at-panel" role="dialog" aria-label={t('sidepanel.chatPage.atPanelTitle')}>
      <div className="ds-chat-at-panel-header">
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.chatPage.atPanelTitle')}
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {session
              ? `${session.rootName} · ${t('sidepanel.chatPage.atPanelFileCount', { count: session.files.length })}`
              : t('sidepanel.chatPage.atPanelHint')}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm leading-none opacity-60 hover:opacity-100"
          style={{ color: 'var(--ds-text-secondary)' }}
          aria-label={t('sidepanel.chatPage.atPanelClose')}
        >
          ×
        </button>
      </div>

      <div className="ds-chat-at-panel-body">
        {results.length === 0 ? renderEmpty() : results.map((file) => {
          const isImage = file.kind === 'image';
          const status = statusByPath.get(file.relativePath);
          const disabled = !isImage;
          const disabledTitle = !isImage
            ? (file.kind === 'text'
              ? t('sidepanel.chatPage.atPanelTextPending')
              : t('sidepanel.chatPage.atPanelOtherUnsupported'))
            : undefined;
          return (
            <button
              key={file.relativePath}
              type="button"
              disabled={disabled}
              onClick={() => {
                const sessionFile = sessionFileByPath.get(file.relativePath);
                if (sessionFile) onToggleFile(sessionFile);
              }}
              className={`ds-chat-at-row${disabled ? ' ds-chat-at-row-disabled' : ''}`}
              title={disabledTitle}
              aria-label={status
                ? t('sidepanel.chatPage.atPanelDeselectFile', { name: file.name })
                : t('sidepanel.chatPage.atPanelSelectFile', { name: file.name })}
            >
              <span className="min-w-0 flex-1">
                <span className="ds-chat-at-name" style={{ color: 'var(--ds-text)' }}>
                  {file.name}
                </span>
                <span className="ds-chat-at-path" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {file.relativePath}
                </span>
              </span>
              {status && (
                <span className="ds-chat-at-badge" style={{ color: 'var(--ds-success)' }}>
                  {status === 'uploading'
                    ? t('sidepanel.chatPage.imageUploading')
                    : status === 'error'
                      ? t('sidepanel.chatPage.imageUploadFailed')
                      : t('sidepanel.chatPage.imageReady')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

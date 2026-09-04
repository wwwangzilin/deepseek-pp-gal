import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { countTrustedFilesByKind } from '../../../../core/trusted-directory/scan';
import {
  clearTrustedDirectoryMeta,
  getTrustedDirectoryMeta,
  saveTrustedDirectoryMeta,
} from '../../../../core/trusted-directory/store';
import {
  TRUSTED_DIRECTORY_SCHEMA_VERSION,
  type TrustedDirectoryMeta,
} from '../../../../core/trusted-directory/types';
import { useI18n } from '../../i18n';
import {
  buildTrustedDirectorySession,
  getTrustedDirectorySession,
  setTrustedDirectorySession,
  type TrustedDirectorySession,
} from '../../trusted-directory';
import { SettingsSection, StatusMessage, useBanner, useConfirm } from './primitives';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function metaFromSession(session: TrustedDirectorySession): TrustedDirectoryMeta {
  return {
    schemaVersion: TRUSTED_DIRECTORY_SCHEMA_VERSION,
    rootName: session.rootName,
    pickedAt: session.pickedAt,
    fileCount: session.files.length,
    totalBytes: session.files.reduce((sum, file) => sum + file.sizeBytes, 0),
    skippedCount: session.skippedCount,
    truncated: session.truncated,
  };
}

export default function ProjectFilesSubPage() {
  const { t } = useI18n();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<TrustedDirectoryMeta | null | undefined>(undefined);
  const [session, setSessionState] = useState<TrustedDirectorySession | null>(() => getTrustedDirectorySession());
  const [pickError, setPickError] = useState<string | null>(null);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  useEffect(() => {
    let alive = true;
    void getTrustedDirectoryMeta().then((value) => {
      if (alive) setMeta(value);
    }).catch((err) => {
      if (alive) setPickError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      alive = false;
    };
  }, []);

  const handlePick = () => {
    pickerRef.current?.click();
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length === 0) return;
    try {
      const nextSession = buildTrustedDirectorySession(files);
      if (!nextSession) {
        setPickError(t('sidepanel.settings.projectFilesPickFailed'));
        return;
      }
      setPickError(null);
      setSessionState(nextSession);
      setTrustedDirectorySession(nextSession);
      const nextMeta = metaFromSession(nextSession);
      setMeta(nextMeta);
      void saveTrustedDirectoryMeta(nextMeta).catch((err) => {
        banner.show('error', err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemove = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.projectFilesRemove'),
      message: t('sidepanel.settings.projectFilesRemoveConfirm'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    setSessionState(null);
    setTrustedDirectorySession(null);
    setMeta(null);
    setPickError(null);
    try {
      await clearTrustedDirectoryMeta();
    } catch (err) {
      banner.show('error', err instanceof Error ? err.message : String(err));
    }
  };

  const counts = session ? countTrustedFilesByKind(session.files) : null;

  return (
    <SettingsSection
      title={t('sidepanel.settings.projectFilesSection')}
      description={t('sidepanel.settings.projectFilesSectionDescription')}
    >
      <input
        ref={pickerRef}
        type="file"
        className="ds-chat-file-input"
        multiple
        onChange={handlePickerChange}
        aria-label={t('sidepanel.settings.projectFilesChoose')}
        {...({ webkitdirectory: '' } as Record<string, string>)}
      />

      {pickError && (
        <StatusMessage tone="error" onDismiss={() => setPickError(null)}>
          {pickError}
        </StatusMessage>
      )}
      {banner.node}
      {confirmNode}

      {meta === undefined ? (
        <div className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('common.loading')}
        </div>
      ) : session ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
              {session.rootName}
            </span>
            <span
              className="text-[10px] px-2 py-0.5 font-medium"
              style={{
                color: 'var(--ds-success)',
                background: 'var(--ds-success-bg)',
                borderRadius: 'var(--radius-ctrl)',
              }}
            >
              {t('sidepanel.settings.projectFilesAuthorized')}
            </span>
          </div>
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.projectFilesFiles', { count: session.files.length })}
            {' · '}
            {formatBytes(meta?.totalBytes ?? 0)}
            {session.skippedCount > 0 && (
              <> · {t('sidepanel.settings.projectFilesSkipped', { count: session.skippedCount })}</>
            )}
            {session.truncated && (
              <div style={{ color: 'var(--ds-warning)' }}>
                {t('sidepanel.settings.projectFilesTruncated', { count: session.files.length })}
              </div>
            )}
          </div>
          {counts && (
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.projectFilesImagesReady', { count: counts.images })}
              <br />
              {t('sidepanel.settings.projectFilesTextPending', { count: counts.text })}
              {counts.other > 0 && (
                <> · {t('sidepanel.settings.projectFilesOther', { count: counts.other })}</>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handlePick} className="ds-btn-secondary px-3 py-2 text-xs rounded-lg font-medium">
              {t('sidepanel.settings.projectFilesChooseAgain')}
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="ds-btn-secondary px-3 py-2 text-xs rounded-lg font-medium"
              style={{ color: 'var(--ds-danger)' }}
            >
              {t('sidepanel.settings.projectFilesRemove')}
            </button>
          </div>
        </div>
      ) : meta ? (
        <div className="space-y-2">
          <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
            {meta.rootName}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ds-warning)' }}>
            {t('sidepanel.settings.projectFilesSessionExpired')}
          </div>
          <button type="button" onClick={handlePick} className="ds-btn-secondary px-3 py-2 text-xs rounded-lg font-medium">
            {t('sidepanel.settings.projectFilesChooseAgain')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.settings.projectFilesSectionDescription')}
          </div>
          <button type="button" onClick={handlePick} className="ds-btn-secondary px-3 py-2 text-xs rounded-lg font-medium">
            {t('sidepanel.settings.projectFilesChoose')}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

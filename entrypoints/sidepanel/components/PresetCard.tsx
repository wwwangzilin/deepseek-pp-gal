import type { SystemPromptPreset } from '../../../core/types';
import { useI18n } from '../i18n';

interface Props {
  preset: SystemPromptPreset;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function PresetCard({ preset, isActive, onActivate, onDeactivate, onEdit, onDelete }: Props) {
  const { t } = useI18n();

  return (
    <div
      className="ds-card rounded-xl p-3.5 group transition-all duration-150"
      style={isActive ? { borderColor: 'var(--ds-blue)', borderWidth: '1.5px' } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            {preset.name}
          </span>
          {isActive && (
            <span className="ds-badge-success inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium">
              {t('sidepanel.preset.activeBadge')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={isActive ? onDeactivate : onActivate}
            className="text-[11px] px-2 py-1 rounded-md transition-all duration-150"
            style={{
              color: isActive ? 'var(--ds-text-secondary)' : 'var(--ds-blue)',
              background: isActive ? 'var(--ds-surface)' : 'transparent',
            }}
          >
            {isActive ? t('common.deactivate') : t('common.enable')}
          </button>
          <button
            onClick={onEdit}
            aria-label={t('common.edit')}
            className="text-[11px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-150"
            style={{ color: 'var(--ds-text-secondary)' }}
          >
            {t('common.edit')}
          </button>
          <button
            onClick={onDelete}
            aria-label={t('common.delete')}
            className="ds-text-btn-delete text-[11px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-150"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
      <p
        className="text-xs mt-1.5 leading-relaxed line-clamp-2"
        style={{ color: 'var(--ds-text-secondary)' }}
      >
        {preset.content.slice(0, 120)}{preset.content.length > 120 ? '...' : ''}
      </p>
    </div>
  );
}

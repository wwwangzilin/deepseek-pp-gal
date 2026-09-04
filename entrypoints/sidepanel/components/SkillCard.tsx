import type { LocaleMessageKey } from '../../../core/i18n';
import type { Skill } from '../../../core/types';
import { SVG_PATHS } from '../constants';
import { useI18n } from '../i18n';

interface Props {
  skill: Skill;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleEnabled?: () => void;
  onUpdate?: () => void;
  busy?: boolean;
}

const SOURCE_LABELS: Record<string, { labelKey: LocaleMessageKey; tone: 'muted' | 'accent' }> = {
  builtin: { labelKey: 'sidepanel.skill.sources.builtin', tone: 'muted' },
  official: { labelKey: 'sidepanel.skill.sources.official', tone: 'muted' },
  'third-party': { labelKey: 'sidepanel.skill.sources.thirdParty', tone: 'muted' },
  custom: { labelKey: 'sidepanel.skill.sources.custom', tone: 'muted' },
  remote: { labelKey: 'sidepanel.skill.sources.remote', tone: 'muted' },
};

export default function SkillCard({ skill, onEdit, onDelete, onToggleEnabled, onUpdate, busy }: Props) {
  const { t } = useI18n();
  const badge = skill.remote?.provider === 'local'
    ? { labelKey: 'sidepanel.skill.sources.local' as LocaleMessageKey, tone: 'accent' as const }
    : SOURCE_LABELS[skill.source];
  const enabled = skill.enabled !== false;
  const hasActions = Boolean(onEdit || onDelete || onToggleEnabled);
  const toggleLabel = enabled
    ? t('sidepanel.skill.actions.disableSkill', { name: skill.name })
    : t('sidepanel.skill.actions.enableSkill', { name: skill.name });

  return (
    <div
      className="ds-card group"
      style={{ padding: '12px 14px', opacity: enabled ? undefined : 0.6 }}
    >
      {/* Header: trigger chip + single source label + hover actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <code
            className="font-mono font-semibold"
            style={{
              fontSize: '12px',
              padding: '2px 6px',
              borderRadius: 'var(--radius-ctrl)',
              background: 'var(--ds-blue-light)',
              color: 'var(--ds-blue)',
            }}
          >
            /{skill.name}
          </code>
          {badge && (
            <span
              className="text-[10px] font-medium uppercase tracking-wide"
              style={{
                color: badge.tone === 'accent' ? 'var(--ds-success)' : 'var(--ds-text-tertiary)',
              }}
            >
              {t(badge.labelKey)}
            </span>
          )}
          {!enabled && (
            <span
              className="text-[10px] font-medium uppercase tracking-wide"
              style={{ color: 'var(--ds-warning)' }}
            >
              {t('sidepanel.skill.disabledBadge')}
            </span>
          )}
        </div>
        {hasActions && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
            {onToggleEnabled && (
              <button
                type="button"
                title={enabled ? t('common.deactivate') : t('common.enable')}
                aria-label={toggleLabel}
                onClick={onToggleEnabled}
                className="ds-action-btn w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={enabled ? 'M18.364 18.364A9 9 0 015.636 5.636m12.728 12.728A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636' : 'M5 13l4 4L19 7'} />
                </svg>
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                title={t('common.edit')}
                aria-label={t('sidepanel.skill.actions.editSkill', { name: skill.name })}
                onClick={onEdit}
                className="ds-action-btn ds-action-btn-edit w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.edit} />
                </svg>
              </button>
            )}
            {onUpdate && skill.remote?.provider === 'local' && (
              <button
                type="button"
                title={t('sidepanel.skill.actions.updateSkill')}
                aria-label={t('sidepanel.skill.actions.updateSkill')}
                onClick={onUpdate}
                disabled={busy}
                className="ds-action-btn w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                {busy ? (
                  <span
                    className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                title={t('common.delete')}
                aria-label={t('sidepanel.skill.actions.deleteSkill', { name: skill.name })}
                onClick={onDelete}
                className="ds-action-btn ds-action-btn-delete w-7 h-7 flex items-center justify-center"
                style={{ borderRadius: 'var(--radius-ctrl)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.trash} />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description — give it air */}
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)', marginTop: '8px' }}>
        {skill.description}
      </p>

      {/* Meta — a quiet rule-separated line, not a cluster of pills */}
      {((skill.remote && (skill.remote.repository || skill.remote.path)) || skill.memoryEnabled) && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]"
          style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--ds-border)', color: 'var(--ds-text-tertiary)' }}
        >
          {skill.remote && skill.remote.repository && (
            <span className="font-mono">{skill.remote.repository}</span>
          )}
          {skill.remote && skill.remote.path && (
            <span>{skill.remote.path}</span>
          )}
          {skill.remote && skill.remote.provider === 'local' && skill.remote.localDirectory && (
            <span className="font-mono">{skill.remote.localDirectory ?? skill.remote.localRootPath}</span>
          )}
          {skill.memoryEnabled && (
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--ds-success)' }}>
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.chip} />
              </svg>
              {t('sidepanel.skill.memoryEnabledBadge')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

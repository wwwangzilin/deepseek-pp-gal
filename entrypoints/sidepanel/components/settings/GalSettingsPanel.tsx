import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GAL_SETTINGS,
  normalizeGalSettings,
} from '../../../../core/character/codec';
import type { GalSettings } from '../../../../core/types';
import { createRequestGenerationFence } from '../../async-state';
import { useI18n } from '../../i18n';
import { getRuntimeErrorMessage } from '../../runtime-response';
import { sidepanelRuntimeClient } from '../../runtime-client';

/**
 * GAL stage settings panel (rendered on the Settings → Prompt sub-page).
 * Self-contained: loads/saves GalSettings through the runtime client and
 * keeps the extension-owned store as the single authority for the stage
 * default-off switch and the character persona injection cadence.
 */
export default function GalSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<GalSettings>({ ...DEFAULT_GAL_SETTINGS });
  const [statusMessage, setStatusMessage] = useState('');
  const requestFence = useRef(createRequestGenerationFence());

  useEffect(() => {
    const generation = requestFence.current.begin();
    sidepanelRuntimeClient.request(
      { type: 'GET_GAL_SETTINGS' },
      {
        unavailableMessage: t('sidepanel.galSettings.loadFailed', { error: 'unavailable' }),
        decode: (value) => normalizeGalSettings(value),
      },
    )
      .then((loaded) => {
        if (requestFence.current.isCurrent(generation)) {
          setSettings(normalizeGalSettings(loaded));
        }
      })
      .catch((error) => {
        if (!requestFence.current.isCurrent(generation)) return;
        setSettings({ ...DEFAULT_GAL_SETTINGS });
        setStatusMessage(t('sidepanel.galSettings.loadFailed', {
          error: getRuntimeErrorMessage(error),
        }));
      });
    return () => requestFence.current.invalidate();
  }, [t]);

  const save = async (patch: Partial<GalSettings>) => {
    const previous = settings;
    const next = normalizeGalSettings({ ...settings, ...patch });
    setSettings(next);
    setStatusMessage('');
    const generation = requestFence.current.begin();
    try {
      const saved = await sidepanelRuntimeClient.request(
        { type: 'SAVE_GAL_SETTINGS', payload: next },
        {
          unavailableMessage: t('sidepanel.galSettings.saveFailed', { error: 'unavailable' }),
          decode: (value) => normalizeGalSettings(value),
        },
      );
      if (requestFence.current.isCurrent(generation)) {
        setSettings(normalizeGalSettings(saved));
        setStatusMessage(t('sidepanel.galSettings.saved'));
      }
    } catch (error) {
      if (!requestFence.current.isCurrent(generation)) return;
      setSettings(previous);
      setStatusMessage(t('sidepanel.galSettings.saveFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
        {t('sidepanel.galSettings.title')}
      </h2>
      <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.galSettings.description')}
      </p>

      <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.enabledLabel')}
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
      </label>
      <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.galSettings.enabledHint')}
      </p>

      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.cadenceLabel')}
        </span>
        <select
          value={settings.characterCadence}
          onChange={(event) => void save({
            characterCadence: event.target.value as GalSettings['characterCadence'],
          })}
          className="rounded border bg-transparent text-[12px] px-2 py-1"
          style={{ color: 'var(--ds-text)', borderColor: 'var(--ds-border, rgba(255,255,255,.15))' }}
        >
          <option value="every_message">{t('sidepanel.galSettings.cadenceEvery')}</option>
          <option value="first_message">{t('sidepanel.galSettings.cadenceFirst')}</option>
          <option value="off">{t('sidepanel.galSettings.cadenceOff')}</option>
        </select>
      </div>

      <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.proactiveLabel')}
        </span>
        <input
          type="checkbox"
          checked={settings.proactiveEnabled === true}
          onChange={(event) => void save({ proactiveEnabled: event.target.checked })}
        />
      </label>
      <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.galSettings.proactiveHint')}
      </p>
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.proactiveMinutesLabel')}
        </span>
        <input
          type="number"
          min={1}
          max={240}
          value={settings.proactiveIdleMinutes ?? 10}
          onChange={(event) => void save({
            proactiveIdleMinutes: Math.max(1, Math.min(240, Number(event.target.value) || 10)),
          })}
          className="w-20 rounded border bg-transparent px-2 py-1 text-[12px]"
          style={{ color: 'var(--ds-text)', borderColor: 'var(--ds-border, rgba(255,255,255,.15))' }}
        />
      </div>

      <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.ttsLabel')}
        </span>
        <input
          type="checkbox"
          checked={settings.ttsEnabled === true}
          onChange={(event) => void save({ ttsEnabled: event.target.checked })}
        />
      </label>
      <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.galSettings.ttsHint')}
      </p>
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-[12px]" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.galSettings.ttsRateLabel')}
        </span>
        <input
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={settings.ttsRate ?? 1}
          onChange={(event) => void save({
            ttsRate: Math.max(0.5, Math.min(2, Number(event.target.value) || 1)),
          })}
          className="w-20 rounded border bg-transparent px-2 py-1 text-[12px]"
          style={{ color: 'var(--ds-text)', borderColor: 'var(--ds-border, rgba(255,255,255,.15))' }}
        />
      </div>

      {statusMessage && (
        <p className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
          {statusMessage}
        </p>
      )}
    </section>
  );
}

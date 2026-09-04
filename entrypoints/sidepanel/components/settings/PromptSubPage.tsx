import PromptControlPanel from '../PromptControlPanel';
import ScenarioManager from '../ScenarioManager';
import { useI18n } from '../../i18n';

/**
 * Prompt sub-page.
 *
 * PromptControlPanel and ScenarioManager are self-contained components that
 * already render their own <section><h2> framing and own their chrome.runtime
 * state. We render them directly so their headers act as the section titles,
 * avoiding the duplicate title that a SettingsSection wrapper would create.
 * The only fix here versus the legacy layout is that ScenarioManager now lives
 * inside a panel: it previously dropped into SettingsPage without any surface
 * wrapper, causing a visual break. That is addressed in ScenarioManager itself.
 */
export default function PromptSubPage() {
  const { t } = useI18n();
  void t;
  return (
    <div className="space-y-5">
      <PromptControlPanel />
      <ScenarioManager />
    </div>
  );
}

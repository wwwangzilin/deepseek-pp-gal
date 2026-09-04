import VoiceSettingsPanel from '../VoiceSettingsPanel';

/**
 * Voice sub-page. VoiceSettingsPanel is self-contained (own <section><h2> and
 * chrome.runtime state), so render it directly.
 */
export default function VoiceSubPage() {
  return (
    <div className="space-y-5">
      <VoiceSettingsPanel />
    </div>
  );
}

const STYLE_ID = 'dpp-injected-theme-css';

export function injectInjectedThemeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Injected UI shares the same cool-ink palette as the sidepanel (--ds-*) so the
  // tool cards / inline agent / skill popup feel like one product with the panel,
  // not a neutral-gray bolt-on. Accent is the same interaction blue, kept
  // disciplined: surface/depth comes from borders + inset highlights, not glow.
  //
  // --ds-* ↔ --dpp-ui-* mapping (sidepanel style.css :root, light mode):
  //   --dpp-ui-surface        ← --ds-card          oklch(0.998 0.002 264)
  //   --dpp-ui-surface-muted  ← --ds-surface       oklch(0.965 0.005 264)
  //   --dpp-ui-surface-hover  ← --ds-surface-hover oklch(0.95 0.006 264)
  //   --dpp-ui-text           ← --ds-text          oklch(0.24 0.018 264)
  //   --dpp-ui-text-muted     ← --ds-text-secondary oklch(0.52 0.020 264)
  //   --dpp-ui-text-subtle    ← --ds-text-tertiary oklch(0.70 0.015 264)
  //   --dpp-ui-border         ← --ds-border        oklch(0.90 0.008 264)
  //   --dpp-ui-border-muted   ← derived (1 step lighter than --ds-border)
  //   --dpp-ui-accent         ← --ds-blue          oklch(0.62 0.19 264) ≈ #4D6BFE
  //   --dpp-ui-accent-strong  ← --ds-blue-hover    oklch(0.56 0.20 266) ≈ #3B5BEE
  //   --dpp-ui-accent-soft    ← --ds-blue-light    oklch(0.96 0.025 264)
  //   --dpp-ui-accent-panel   ← --ds-blue-glow     oklch(0.62 0.19 264 / 0.14)
  //   --dpp-ui-code-bg        ← derived (translucent ink)
  //   --dpp-ui-danger-panel   ← --ds-danger-bg     oklch(0.96 0.03 25)
  //   --dpp-ui-success        ← --ds-success       oklch(0.70 0.15 162)
  //   --dpp-ui-warning        ← --ds-warning       oklch(0.75 0.15 75)
  //   --dpp-ui-error          ← --ds-danger        oklch(0.64 0.22 25)
  //   --dpp-ui-shadow         ← --ds-elevate-1
  //   --dpp-ui-panel-shadow   ← --ds-shadow-lg
  // Dark mode mirrors the sidepanel dark palette at :root (style.css, dark block).
  // Keep both files in sync when tuning values.
  style.textContent = `
body {
  --dpp-ui-surface:      oklch(0.998 0.002 264);
  --dpp-ui-surface-muted: oklch(0.965 0.005 264);
  --dpp-ui-surface-hover: oklch(0.95 0.006 264);
  --dpp-ui-text:         oklch(0.24 0.018 264);
  --dpp-ui-text-muted:   oklch(0.52 0.020 264);
  --dpp-ui-text-subtle:  oklch(0.70 0.015 264);
  --dpp-ui-border:       oklch(0.90 0.008 264);
  --dpp-ui-border-muted: oklch(0.94 0.006 264);
  --dpp-ui-accent:       oklch(0.62 0.19 264);
  --dpp-ui-accent-strong: oklch(0.56 0.20 266);
  --dpp-ui-accent-soft:  oklch(0.96 0.025 264);
  --dpp-ui-accent-panel: oklch(0.62 0.19 264 / 0.06);
  --dpp-ui-code-bg:      oklch(0.30 0.02 264 / 0.06);
  --dpp-ui-danger-panel: oklch(0.64 0.22 25 / 0.08);
  --dpp-ui-success:      oklch(0.70 0.15 162);
  --dpp-ui-warning:      oklch(0.75 0.15 75);
  --dpp-ui-error:        oklch(0.64 0.22 25);
  --dpp-ui-shadow:       0 0 0 1px var(--dpp-ui-border), inset 0 1px 0 oklch(1 0 0 / 0.05);
  --dpp-ui-panel-shadow: -14px 0 40px oklch(0.25 0.04 264 / 0.14);
}

body.dpp-theme-dark {
  --dpp-ui-surface:      oklch(0.22 0.014 264);
  --dpp-ui-surface-muted: oklch(0.25 0.014 264);
  --dpp-ui-surface-hover: oklch(0.29 0.015 264);
  --dpp-ui-text:         oklch(0.93 0.012 264);
  --dpp-ui-text-muted:   oklch(0.76 0.015 264);
  --dpp-ui-text-subtle:  oklch(0.60 0.015 264);
  --dpp-ui-border:       oklch(0.32 0.014 264);
  --dpp-ui-border-muted: oklch(0.28 0.014 264);
  --dpp-ui-accent:       oklch(0.75 0.14 264);
  --dpp-ui-accent-strong: oklch(0.82 0.12 264);
  --dpp-ui-accent-soft:  oklch(0.30 0.06 264 / 0.55);
  --dpp-ui-accent-panel: oklch(0.75 0.14 264 / 0.12);
  --dpp-ui-code-bg:      oklch(1 0 0 / 0.08);
  --dpp-ui-danger-panel: oklch(0.30 0.06 25 / 0.22);
  --dpp-ui-success:      oklch(0.78 0.14 162);
  --dpp-ui-warning:      oklch(0.80 0.14 75);
  --dpp-ui-error:        oklch(0.72 0.18 25);
  --dpp-ui-shadow:       0 0 0 1px var(--dpp-ui-border), inset 0 1px 0 oklch(1 0 0 / 0.04);
  --dpp-ui-panel-shadow: -14px 0 40px oklch(0.02 0.01 264 / 0.5);
}

@media (prefers-color-scheme: dark) {
  body:not(.dpp-theme-light) {
    --dpp-ui-surface:      oklch(0.22 0.014 264);
    --dpp-ui-surface-muted: oklch(0.25 0.014 264);
    --dpp-ui-surface-hover: oklch(0.29 0.015 264);
    --dpp-ui-text:         oklch(0.93 0.012 264);
    --dpp-ui-text-muted:   oklch(0.76 0.015 264);
    --dpp-ui-text-subtle:  oklch(0.60 0.015 264);
    --dpp-ui-border:       oklch(0.32 0.014 264);
    --dpp-ui-border-muted: oklch(0.28 0.014 264);
    --dpp-ui-accent:       oklch(0.75 0.14 264);
    --dpp-ui-accent-strong: oklch(0.82 0.12 264);
    --dpp-ui-accent-soft:  oklch(0.30 0.06 264 / 0.55);
    --dpp-ui-accent-panel: oklch(0.75 0.14 264 / 0.12);
    --dpp-ui-code-bg:      oklch(1 0 0 / 0.08);
      --dpp-ui-danger-panel: oklch(0.30 0.06 25 / 0.22);
    --dpp-ui-success:      oklch(0.78 0.14 162);
    --dpp-ui-warning:      oklch(0.80 0.14 75);
    --dpp-ui-error:        oklch(0.72 0.18 25);
    --dpp-ui-shadow:       0 0 0 1px var(--dpp-ui-border), inset 0 1px 0 oklch(1 0 0 / 0.04);
    --dpp-ui-panel-shadow: -14px 0 40px oklch(0.02 0.01 264 / 0.5);
  }
}
`;
  document.head.appendChild(style);
}

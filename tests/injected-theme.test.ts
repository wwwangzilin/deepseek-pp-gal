import { afterEach, describe, expect, it } from 'vitest';
import { injectInjectedThemeStyles } from '../core/ui/injected-theme';

describe('injected UI theme styles', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('defines high-contrast variables for DeepSeek dark theme and system dark mode', () => {
    injectInjectedThemeStyles();

    const css = document.getElementById('dpp-injected-theme-css')?.textContent ?? '';
    // Dark override block + system-dark fallback both present.
    expect(css).toContain('body.dpp-theme-dark');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('body:not(.dpp-theme-light)');
    // Shared cool-ink oklch palette (not neutral hex) so injected UI matches the panel.
    expect(css).toContain('--dpp-ui-accent:       oklch(0.62 0.19 264)');
    // Dark surfaces are derived to lighter oklch values for contrast.
    expect(css).toMatch(/--dpp-ui-text:\s+oklch\(0\.93 0\.012 264\)/);
    expect(css).toMatch(/--dpp-ui-surface:\s+oklch\(0\.22 0\.014 264\)/);
  });

  it('injects the shared theme stylesheet once', () => {
    injectInjectedThemeStyles();
    injectInjectedThemeStyles();

    expect(document.querySelectorAll('#dpp-injected-theme-css')).toHaveLength(1);
  });
});

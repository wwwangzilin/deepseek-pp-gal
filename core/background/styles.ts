// Background-feature surface + injected stylesheet generation (issue #565).
//
// Kept pure (no DOM / browser imports) so the exact styles a user sees can be asserted in
// tests, mirroring core/ui/injected-theme.ts. The body CSS variables are computed from the
// configured opacity and the injected <style id="dpp-bg-style"> selects the active light or
// dark value through the same body theme class / prefers-color-scheme rules used elsewhere,
// so a theme switch while the background is enabled stays coherent.

export interface BackgroundSurfaceTokens {
  readonly overlayLight: string;
  readonly overlayDark: string;
  readonly surfaceLight: string;
  readonly surfaceDark: string;
  readonly blur: string;
}

export function computeBackgroundTokens(opacity: number): BackgroundSurfaceTokens {
  const overlayAlpha = (1 - opacity).toFixed(3);
  // Surfaces stay readable (never fully transparent) but let the blurred background image
  // tint through subtly. Small opacity variation keeps the default (0.3) behavior close while
  // preserving legibility across the opacity range.
  const surfaceAlpha = Math.min(0.9, 0.84 + opacity * 0.15).toFixed(3);
  const blurPx = ((1 - opacity) * 8).toFixed(1);
  return {
    overlayLight: `rgba(250, 250, 252, ${overlayAlpha})`,
    overlayDark: `rgba(28, 28, 33, ${overlayAlpha})`,
    surfaceLight: `rgba(249, 250, 252, ${surfaceAlpha})`,
    surfaceDark: `rgba(30, 31, 36, ${surfaceAlpha})`,
    blur: `blur(${blurPx}px)`,
  };
}

export function buildBackgroundStyleSheet(): string {
  // The app root shells stay transparent so the fixed #dpp-bg layer (negative z-index) can
  // be the backdrop; an opaque body/root background would paint over it. Deep containers are
  // NOT punched through blanket-style anymore - only surfaces explicitly marked by
  // patchContainerBackgrounds get converged, and even those reuse a theme-linked translucent
  // surface instead of full transparency, so text keeps its readable ground and scrolling
  // messages do not bleed through raw page decorations.
  return `
    #dpp-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--dpp-overlay-light);
      backdrop-filter: var(--dpp-blur);
      -webkit-backdrop-filter: var(--dpp-blur);
      pointer-events: none;
    }

    body.dpp-bg-active,
    body.dpp-bg-active #root,
    body.dpp-bg-active #__next {
      background: transparent !important;
    }

    body.dpp-bg-active [data-dpp-transparent] {
      background: var(--dpp-surface-light) !important;
    }

    body.dpp-theme-dark #dpp-bg::after {
      background: var(--dpp-overlay-dark);
    }

    body.dpp-theme-dark [data-dpp-transparent] {
      background: var(--dpp-surface-dark) !important;
    }

    @media (prefers-color-scheme: dark) {
      body:not(.dpp-theme-light) #dpp-bg::after {
        background: var(--dpp-overlay-dark);
      }

      body:not(.dpp-theme-light) [data-dpp-transparent] {
        background: var(--dpp-surface-dark) !important;
      }
    }
  `;
}

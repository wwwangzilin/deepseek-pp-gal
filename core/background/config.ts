import type { BackgroundConfig } from '../types';

export const DEFAULT_BACKGROUND_OPACITY = 0.3;
export const MIN_BACKGROUND_OPACITY = 0.05;
export const MAX_BACKGROUND_OPACITY = 1;

export function clampBackgroundOpacity(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_BACKGROUND_OPACITY;
  return Math.min(MAX_BACKGROUND_OPACITY, Math.max(MIN_BACKGROUND_OPACITY, numeric));
}

export function normalizeBackgroundConfig(config: Partial<BackgroundConfig> | null | undefined): BackgroundConfig | null {
  if (!config) return null;

  return {
    enabled: config.enabled ?? false,
    type: config.type === 'url' ? 'url' : 'upload',
    url: config.url ?? '',
    imageData: config.imageData ?? '',
    opacity: clampBackgroundOpacity(config.opacity),
  };
}

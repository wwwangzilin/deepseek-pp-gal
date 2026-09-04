import type { PetConfig, PetCustomPosition, PetPosition } from '../types';

export const DEFAULT_PET_SIZE = 132;
export const MIN_PET_SIZE = 84;
export const MAX_PET_SIZE = 220;
export const DEFAULT_PET_OPACITY = 0.96;
export const MIN_PET_OPACITY = 0.45;
export const MAX_PET_OPACITY = 1;

export const DEFAULT_PET_CONFIG: PetConfig = {
  enabled: false,
  position: 'bottom-right',
  size: DEFAULT_PET_SIZE,
  opacity: DEFAULT_PET_OPACITY,
  motion: true,
};

export function clampPetSize(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_PET_SIZE;
  return Math.min(MAX_PET_SIZE, Math.max(MIN_PET_SIZE, Math.round(numeric)));
}

export function clampPetOpacity(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_PET_OPACITY;
  return Math.min(MAX_PET_OPACITY, Math.max(MIN_PET_OPACITY, numeric));
}

function clampPetPositionRatio(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizePosition(value: unknown): PetPosition {
  if (value === 'custom') return 'custom';
  return value === 'bottom-left' ? 'bottom-left' : 'bottom-right';
}

function normalizeCustomPosition(value: unknown): PetCustomPosition | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as Partial<PetCustomPosition>;
  const x = clampPetPositionRatio(position.x);
  const y = clampPetPositionRatio(position.y);
  if (x === null || y === null) return null;
  return { x, y };
}

export function normalizePetConfig(config: Partial<PetConfig> | null | undefined): PetConfig {
  if (!config) return { ...DEFAULT_PET_CONFIG };
  const position = normalizePosition(config.position);
  const customPosition = normalizeCustomPosition(config.customPosition);

  const normalized: PetConfig = {
    enabled: config.enabled ?? DEFAULT_PET_CONFIG.enabled,
    position: position === 'custom' && !customPosition ? DEFAULT_PET_CONFIG.position : position,
    size: clampPetSize(config.size),
    opacity: clampPetOpacity(config.opacity),
    motion: config.motion ?? DEFAULT_PET_CONFIG.motion,
  };

  if (normalized.position === 'custom' && customPosition) {
    normalized.customPosition = customPosition;
  }

  return normalized;
}

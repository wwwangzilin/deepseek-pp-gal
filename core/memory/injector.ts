import { buildPromptAugmentation, type PromptAugmentationOptions } from '../prompt';
import type { Memory } from '../types';

export interface AugmentOptions extends Omit<PromptAugmentationOptions, 'memories'> {}

export function buildAugmentedPrompt(
  originalPrompt: string,
  allMemories: Memory[],
  options?: AugmentOptions,
): { augmented: string; usedMemoryIds: number[] } {
  return buildPromptAugmentation(originalPrompt, {
    ...options,
    memories: allMemories,
  });
}

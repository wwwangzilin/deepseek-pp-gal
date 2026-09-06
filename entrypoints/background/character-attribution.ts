import type { NewMemory } from '../../core/types';
import { getActivePreset } from '../../core/preset/store';

/**
 * Attributes memories that the model auto-consolidates to the currently
 * active GAL character (characterId).
 *
 * Wired only into the model's memory-tool persistence path:
 * - memories the model saves while roleplaying are attributed to that
 *   character automatically (memory follows the character);
 * - memories added manually from the sidepanel / GAL UI do not go through
 *   here — the caller states ownership explicitly;
 * - when no character-bound preset is active (plain deepseek-pp mode) the
 *   memory is returned unchanged.
 */
export async function attributeMemoryToActiveCharacter(
  memory: NewMemory,
): Promise<NewMemory> {
  const preset = await getActivePreset();
  const characterId = preset?.characterId && preset.characterId.trim() !== ''
    ? preset.characterId.trim()
    : null;
  if (!characterId) return memory;
  return { ...memory, characterId };
}

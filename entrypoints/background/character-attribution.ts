import type { NewMemory } from '../../core/types';
import { getActiveCharacter } from '../../core/character/store';

/**
 * Attributes memories that the model auto-consolidates to the currently
 * active GAL character (characterId).
 *
 * Wired only into the model's memory-tool persistence path:
 * - memories the model saves while roleplaying are attributed to that
 *   character automatically (memory follows the character);
 * - memories added manually from the sidepanel / GAL UI do not go through
 *   here — the caller states ownership explicitly;
 * - when no character is active (plain deepseek-pp mode) the memory is
 *   returned unchanged.
 */
export async function attributeMemoryToActiveCharacter(
  memory: NewMemory,
): Promise<NewMemory> {
  const character = await getActiveCharacter();
  if (!character?.id) return memory;
  return { ...memory, characterId: character.id };
}

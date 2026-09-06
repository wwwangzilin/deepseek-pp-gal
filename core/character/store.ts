import type { GalCharacter, GalSettings, NewGalCharacter } from '../types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
  type RawStorageSlot,
} from '../persistence/versioned-repository';
import {
  DEFAULT_GAL_SETTINGS,
  decodeGalCharacter,
  decodeGalCharacterCollection,
  decodeGalSettings,
  galCharacterCollectionCodec,
  galSettingsCodec,
} from './codec';
import { defaultGalCharacters } from './persona';

/**
 * GAL character library — extension-owned local store (chrome.storage.local).
 *
 * Deliberately independent from the SystemPromptPreset store and from cloud
 * sync: activating a character must not overwrite the user's active preset,
 * and role cards are a fork-local GAL feature (not part of the upstream
 * six-payload sync contract).
 */

export const GAL_CHARACTERS_STORAGE_KEY = 'deepseek_pp_gal_characters';
export const GAL_ACTIVE_CHARACTER_STORAGE_KEY = 'deepseek_pp_gal_active_character_id';
export const GAL_SETTINGS_STORAGE_KEY = 'deepseek_pp_gal_settings';

const characterRepository = createVersionedRepository({
  label: 'gal-characters',
  createDefault: () => [],
  codec: galCharacterCollectionCodec,
  storage: createChromeStorageSlot(GAL_CHARACTERS_STORAGE_KEY),
});
const activeCharacterStorage = createChromeStorageSlot(GAL_ACTIVE_CHARACTER_STORAGE_KEY);
const settingsRepository = createVersionedRepository({
  label: 'gal-settings',
  createDefault: () => ({ ...DEFAULT_GAL_SETTINGS }),
  codec: galSettingsCodec,
  storage: createChromeStorageSlot(GAL_SETTINGS_STORAGE_KEY),
});

export async function getAllCharacters(): Promise<GalCharacter[]> {
  await ensureSeededCharacters();
  return characterRepository.read();
}

/** Seeds the built-in default character on first run (empty library). */
export async function ensureSeededCharacters(): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const characters = await characterRepository.readAlreadyLocked();
    if (characters.length > 0) return;
    const now = Date.now();
    const seeds = decodeGalCharacterCollection(
      defaultGalCharacters().map((item) => ({ ...item, createdAt: now, updatedAt: now })),
      'galCharacters',
    );
    await characterRepository.writeAfterReadAlreadyLocked(seeds);
  });
}

export async function saveCharacter(character: NewGalCharacter): Promise<GalCharacter> {
  const saved = await withSyncLocalStateLock(async () => {
    const characters = await characterRepository.readAlreadyLocked();
    const id = character.id && character.id.trim() !== ''
      ? character.id.trim()
      : makeCharacterId();
    const now = Date.now();
    const existing = characters.find((item) => item.id === id);
    const merged: GalCharacter = existing
      ? decodeGalCharacter({ ...existing, ...character, id, updatedAt: now }, 'galCharacter')
      : decodeGalCharacter({ ...character, id, createdAt: now, updatedAt: now }, 'galCharacter');
    const next = existing
      ? characters.map((item) => (item.id === id ? merged : item))
      : [...characters, merged];
    await characterRepository.writeAfterReadAlreadyLocked(next);
    return merged;
  });
  return saved;
}

export async function deleteCharacter(id: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const characters = await characterRepository.readAlreadyLocked();
    const next = characters.filter((item) => item.id !== id);
    await characterRepository.writeAfterReadAlreadyLocked(next);
    const activeId = await getActiveCharacterIdAlreadyLocked();
    if (activeId === id) await activeCharacterStorage.remove();
  });
}

export async function getActiveCharacterId(): Promise<string | null> {
  return withSyncLocalStateLock(getActiveCharacterIdAlreadyLocked);
}

export async function getActiveCharacterIdAlreadyLocked(): Promise<string | null> {
  return decodeActiveCharacterSlot(await activeCharacterStorage.read());
}

export async function setActiveCharacterId(id: string | null): Promise<void> {
  await withSyncLocalStateLock(async () => {
    if (id === null) {
      await activeCharacterStorage.remove();
      return;
    }
    const trimmed = id.trim();
    if (!trimmed) throw new Error('Character id is required');
    const characters = await characterRepository.readAlreadyLocked();
    if (!characters.some((character) => character.id === trimmed)) {
      throw new Error(`Character was not found: ${trimmed}`);
    }
    await activeCharacterStorage.write(trimmed);
  });
}

export async function getActiveCharacter(): Promise<GalCharacter | null> {
  return withSyncLocalStateLock(async () => {
    const [activeId, characters] = await Promise.all([
      getActiveCharacterIdAlreadyLocked(),
      characterRepository.readAlreadyLocked(),
    ]);
    if (!activeId) return null;
    return characters.find((character) => character.id === activeId) ?? null;
  });
}

export async function getGalSettings(): Promise<GalSettings> {
  return settingsRepository.read();
}

export async function saveGalSettings(settings: Partial<GalSettings>): Promise<GalSettings> {
  return withSyncLocalStateLock(async () => {
    const current = await settingsRepository.readAlreadyLocked();
    const normalized = decodeGalSettings({ ...current, ...settings }, 'galSettings');
    await settingsRepository.writeAfterReadAlreadyLocked(normalized);
    return normalized;
  });
}

export async function replaceCharactersForStartupMigration(
  characters: GalCharacter[],
): Promise<void> {
  const validated = decodeGalCharacterCollection(characters, 'galCharacters');
  await characterRepository.replaceAlreadyLocked(validated);
}

function decodeActiveCharacterSlot(slot: RawStorageSlot): string | null {
  return slot.present
    ? typeof slot.value === 'string' && slot.value.trim() !== ''
      ? slot.value.trim()
      : null
    : null;
}

function makeCharacterId(): string {
  return 'char-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

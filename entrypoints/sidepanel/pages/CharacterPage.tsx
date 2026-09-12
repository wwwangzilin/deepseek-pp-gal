import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalCharacter, GalCharacterCadence, GalGroup, GalSettings, Memory, NewGalCharacter, NewGalGroup } from '../../../core/types';
import { decodeGalCharacter, decodeGalCharacterCollection } from '../../../core/character/codec';
import { buildCharacterCardPng, parseCharacterCardFromPng } from '../../../core/character/card';
import { decodeGalGroup, decodeGalGroupCollection } from '../../../core/group/codec';
import PageIntro from '../components/PageIntro';
import { SkeletonList } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { createRequestGenerationFence } from '../async-state';
import { getRuntimeErrorMessage } from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';

/**
 * GAL character page (sidepanel, top-level tab): manage roleplay character
 * cards in the extension-owned library, switch the active character, and
 * manage each character's scoped memories. The GAL stage on chat.deepseek.com
 * reads the same store — one authority, no localStorage split-brain.
 */

type View = 'list' | 'edit';
type PageTab = 'characters' | 'groups';
interface CharacterDraft extends Omit<GalCharacter, 'id' | 'createdAt' | 'updatedAt'> {}

const BLANK_FIELDS: Omit<GalCharacter, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  color: '#8f7bff',
  avatar: '',
  description: '',
  personality: '',
  scenario: '',
  exampleDialogue: '',
  greeting: '',
  systemPrompt: '',
  memoryTags: [],
  affinity: 0,
};

export default function CharacterPage() {
  const { t } = useI18n();
  const tk = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const [characters, setCharacters] = useState<GalCharacter[]>([]);
  const [groups, setGroups] = useState<GalGroup[]>([]);
  const [pageTab, setPageTab] = useState<PageTab>('characters');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<GalCharacter | null>(null);
  const [groupView, setGroupView] = useState<View>('list');
  const [editingGroup, setEditingGroup] = useState<GalGroup | null>(null);
  const [memoryCharacter, setMemoryCharacter] = useState<GalCharacter | null>(null);
  const [diaryCharacter, setDiaryCharacter] = useState<GalCharacter | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const fence = useRef(createRequestGenerationFence());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dataInputRef = useRef<HTMLInputElement | null>(null);

  const fail = useCallback((error: unknown) => {
    setStatusMessage(t('sidepanel.characterPage.operationFailed', {
      error: getRuntimeErrorMessage(error),
    }));
  }, [t]);

  const load = useCallback(async () => {
    const generation = fence.current.begin();
    try {
      const [list, active, groupList] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_CHARACTERS' },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => decodeGalCharacterCollection(value, 'characterResponse'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_ACTIVE_CHARACTER' },
          {
            acceptFailure: true,
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => (
              value == null ? null : decodeGalCharacter(value, 'activeCharacterResponse')
            ),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_GROUPS' },
          {
            acceptFailure: true,
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => decodeGalGroupCollection(value, 'groupResponse'),
          },
        ),
      ]);
      if (!fence.current.isCurrent(generation)) return;
      setCharacters(list);
      setActiveId(active?.id ?? null);
      setGroups(groupList);
      setLoading(false);
      setStatusMessage('');
    } catch (error) {
      if (!fence.current.isCurrent(generation)) return;
      setLoading(false);
      fail(error);
    }
  }, [t, fail]);

  useEffect(() => {
    void load();
    return () => fence.current.invalidate();
  }, [load]);

  const beginNew = () => {
    setEditing(null);
    setView('edit');
  };

  const beginEdit = (character: GalCharacter) => {
    setEditing(character);
    setView('edit');
  };

  const handleSaveDraft = async (draft: CharacterDraft, existingId: string | null) => {
    const generation = fence.current.begin();
    try {
      const payload: NewGalCharacter = existingId
        ? { ...draft, id: existingId }
        : { ...draft, id: makeCharacterId() };
      const saved = await sidepanelRuntimeClient.request(
        { type: 'SAVE_CHARACTER', payload },
        {
          unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
          decode: (value) => decodeGalCharacter(value, 'saveCharacterResponse'),
        },
      );
      if (!fence.current.isCurrent(generation)) return;
      setView('list');
      setEditing(null);
      await load();
      setStatusMessage(`✔ ${saved.name}`);
    } catch (error) {
      if (!fence.current.isCurrent(generation)) return;
      fail(error);
    }
  };

  const handleDelete = async (character: GalCharacter) => {
    if (!confirm(t('sidepanel.characterPage.deleteConfirm'))) return;
    try {
      await sidepanelRuntimeClient.request(
        { type: 'DELETE_CHARACTER', payload: { id: character.id } },
        {
          unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
          decode: (value) => value,
        },
      );
      await load();
    } catch (error) {
      fail(error);
    }
  };

  const handleActivate = async (id: string | null) => {
    try {
      await sidepanelRuntimeClient.request(
        { type: 'SET_ACTIVE_CHARACTER', payload: { id } },
        {
          unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
          decode: (value) => value,
        },
      );
      await load();
    } catch (error) {
      fail(error);
    }
  };

  const openMemory = (character: GalCharacter) => setMemoryCharacter(character);
  const closeMemory = () => setMemoryCharacter(null);

  const handleSaveGroup = async (draft: NewGalGroup, existingId: string | null) => {
    const generation = fence.current.begin();
    try {
      const payload: NewGalGroup = existingId
        ? { ...draft, id: existingId }
        : { ...draft, id: makeGroupId() };
      await sidepanelRuntimeClient.request(
        { type: 'SAVE_GROUP', payload },
        {
          unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
          decode: (value) => decodeGalGroup(value, 'saveGroupResponse'),
        },
      );
      if (!fence.current.isCurrent(generation)) return;
      setGroupView('list');
      setEditingGroup(null);
      await load();
    } catch (error) {
      if (!fence.current.isCurrent(generation)) return;
      fail(error);
    }
  };

  const handleDeleteGroup = async (group: GalGroup) => {
    if (!confirm(t('sidepanel.characterPage.group.deleteConfirm'))) return;
    try {
      await sidepanelRuntimeClient.request(
        { type: 'DELETE_GROUP', payload: { id: group.id } },
        {
          unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
          decode: (value) => value,
        },
      );
      await load();
    } catch (error) {
      fail(error);
    }
  };

  /** Imports SillyTavern-compatible PNG character cards (multi-select). */
  const handleImportCards = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const generation = fence.current.begin();
    try {
      let imported = 0;
      for (const file of Array.from(files)) {
        const buffer = await file.arrayBuffer();
        const parsed = parseCharacterCardFromPng(new Uint8Array(buffer));
        if (!parsed) continue;
        await sidepanelRuntimeClient.request(
          { type: 'SAVE_CHARACTER', payload: parsed.character },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => decodeGalCharacter(value, 'importCharacterResponse'),
          },
        );
        imported += 1;
      }
      if (!fence.current.isCurrent(generation)) return;
      await load();
      setStatusMessage(t('sidepanel.characterPage.importSuccess', { count: imported }));
    } catch (error) {
      if (!fence.current.isCurrent(generation)) return;
      fail(error);
    }
  };

  /** Exports the character as a PNG card (SillyTavern can read it). */
  /** Exports all GAL data (characters / groups / settings / story saves) as one JSON file. */
  const handleExportAll = async () => {
    try {
      const [characterList, groupList, settings] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_CHARACTERS' },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => decodeGalCharacterCollection(value, 'exportCharacters'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_GROUPS' },
          {
            acceptFailure: true,
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => decodeGalGroupCollection(value, 'exportGroups'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_GAL_SETTINGS' },
          {
            acceptFailure: true,
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => value,
          },
        ),
      ]);
      let saves: unknown = [];
      try {
        const stored = await chrome.storage.local.get('deepseek_pp_gal_saves');
        saves = stored.deepseek_pp_gal_saves ?? [];
      } catch { saves = []; }
      const payload = {
        schema: 'deepseek-pp-gal-export',
        version: 1,
        exportedAt: Date.now(),
        characters: characterList,
        groups: groupList,
        settings,
        saves,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `deepseek-pp-gal-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatusMessage(t('sidepanel.characterPage.exportAllDone'));
    } catch (error) {
      fail(error);
    }
  };

  /** Imports all GAL data (characters upserted one by one, plus groups, settings and merged saves). */
  const handleImportAll = async (file: File | null) => {
    if (!file) return;
    const generation = fence.current.begin();
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
      const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      let imported = 0;
      for (const character of characters) {
        await sidepanelRuntimeClient.request(
          { type: 'SAVE_CHARACTER', payload: character as NewGalCharacter },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => value,
          },
        );
        imported += 1;
      }
      for (const group of groups) {
        await sidepanelRuntimeClient.request(
          { type: 'SAVE_GROUP', payload: group as NewGalGroup },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => value,
          },
        );
      }
      if (parsed.settings && typeof parsed.settings === 'object') {
        await sidepanelRuntimeClient.request(
          { type: 'SAVE_GAL_SETTINGS', payload: parsed.settings as Partial<GalSettings> },
          {
            unavailableMessage: t('sidepanel.characterPage.backendUnavailable'),
            decode: (value) => value,
          },
        );
      }
      if (Array.isArray(parsed.saves) && parsed.saves.length > 0) {
        const stored = await chrome.storage.local.get('deepseek_pp_gal_saves');
        const existing = Array.isArray(stored.deepseek_pp_gal_saves) ? stored.deepseek_pp_gal_saves : [];
        await chrome.storage.local.set({
          deepseek_pp_gal_saves: [...parsed.saves, ...existing].slice(0, 40),
        });
      }
      if (!fence.current.isCurrent(generation)) return;
      await load();
      setStatusMessage(t('sidepanel.characterPage.importAllDone', { count: imported }));
    } catch (error) {
      if (!fence.current.isCurrent(generation)) return;
      setStatusMessage(t('sidepanel.characterPage.importAllFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  const handleExportCard = (character: GalCharacter) => {
    try {
      const png = buildCharacterCardPng(character);
      const blob = new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${character.name || 'character'}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) {
      fail(error);
    }
  };

  if (diaryCharacter) {
    return (
      <CharacterDiary
        character={diaryCharacter}
        groups={groups}
        onBack={() => setDiaryCharacter(null)}
        t={tk}
      />
    );
  }

  if (memoryCharacter) {
    return (
      <CharacterMemories
        character={memoryCharacter}
        onBack={closeMemory}
        t={tk}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2">
        <PageIntro
          title={t('sidepanel.characterPage.title')}
          description={pageTab === 'groups'
            ? t('sidepanel.characterPage.group.description')
            : t('sidepanel.characterPage.description')}
          meta={activeId ? t('sidepanel.characterPage.activeMeta') : undefined}
        />
        <div className="flex gap-2 mt-2">
          {(['characters', 'groups'] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => {
                setPageTab(tabKey);
                setView('list');
                setGroupView('list');
              }}
              className="rounded px-3 py-1.5 text-[12px] font-medium"
              style={{
                color: pageTab === tabKey ? '#fff' : 'var(--ds-text)',
                background: pageTab === tabKey
                  ? 'linear-gradient(135deg,#8f7bff,#4f8cff)'
                  : 'transparent',
                border: '1px solid var(--ds-border, rgba(255,255,255,.15))',
              }}
            >
              {tabKey === 'characters'
                ? t('sidepanel.characterPage.tabs.characters')
                : t('sidepanel.characterPage.tabs.groups')}
            </button>
          ))}
        </div>
        {pageTab === 'characters' ? (
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={beginNew}
              className="rounded px-3 py-1.5 text-[12px] font-medium"
              style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
            >
              ＋ {t('sidepanel.characterPage.create')}
            </button>
            <button
              type="button"
              className="ds-btn text-[12px]"
              onClick={() => fileInputRef.current?.click()}
            >
              ⬆ {t('sidepanel.characterPage.importCard')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => {
                void handleImportCards(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="ds-btn text-[12px]"
              onClick={() => void handleExportAll()}
            >
              ⬇ {t('sidepanel.characterPage.exportAll')}
            </button>
            <button
              type="button"
              className="ds-btn text-[12px]"
              onClick={() => dataInputRef.current?.click()}
            >
              ⬆ {t('sidepanel.characterPage.importAll')}
            </button>
            <input
              ref={dataInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(event) => {
                void handleImportAll(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEditingGroup(null); setGroupView('edit'); }}
            className="mt-2 rounded px-3 py-1.5 text-[12px] font-medium"
            style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
          >
            ＋ {t('sidepanel.characterPage.group.create')}
          </button>
        )}
      </div>

      {pageTab === 'groups' ? (
        groupView === 'edit' ? (
          <GroupForm
            existing={editingGroup}
            characters={characters}
            onSave={handleSaveGroup}
            onCancel={() => { setGroupView('list'); setEditingGroup(null); }}
            t={tk}
          />
        ) : (
          <GroupsList
            groups={groups}
            characters={characters}
            onEdit={(group) => { setEditingGroup(group); setGroupView('edit'); }}
            onDelete={handleDeleteGroup}
            t={tk}
          />
        )
      ) : view === 'edit' ? (
        <CharacterForm
          existing={editing}
          onSave={handleSaveDraft}
          onCancel={() => { setView('list'); setEditing(null); }}
          t={tk}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {statusMessage && (
            <p className="text-[11px] mb-2" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
              {statusMessage}
            </p>
          )}
          {loading ? (
            <SkeletonList rows={3} />
          ) : characters.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
              {t('sidepanel.characterPage.empty')}
              <br />
              {t('sidepanel.characterPage.emptyHelp')}
            </p>
          ) : (
            <div className="space-y-2">
              {characters.map((character) => {
                const isActive = character.id === activeId;
                return (
                  <div
                    key={character.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: isActive ? '#8f7bff' : 'var(--ds-border, rgba(255,255,255,.1))',
                      background: isActive
                        ? 'rgba(143,123,255,.12)'
                        : 'var(--ds-card, rgba(255,255,255,.03))',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar character={character} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
                            {character.name}
                          </span>
                          <span className="text-[10px] shrink-0" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
                            ❤️ {Math.round(character.affinity ?? 0)}
                          </span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 rounded" style={{ color: '#34d399' }}>
                              {t('sidepanel.characterPage.activeMeta')}
                            </span>
                          )}
                        </div>
                        {character.description && (
                          <div className="text-[11px] truncate" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
                            {character.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {isActive ? (
                        <button type="button" className="ds-btn text-[11px]" onClick={() => void handleActivate(null)}>
                          {t('sidepanel.characterPage.deactivate')}
                        </button>
                      ) : (
                        <button type="button" className="ds-btn text-[11px]" onClick={() => void handleActivate(character.id)}>
                          {t('sidepanel.characterPage.switchTo')}
                        </button>
                      )}
                      <button type="button" className="ds-btn text-[11px]" onClick={() => beginEdit(character)}>
                        {t('sidepanel.characterPage.edit')}
                      </button>
                      <button type="button" className="ds-btn text-[11px]" onClick={() => openMemory(character)}>
                        {t('sidepanel.characterPage.memoryAction')}
                      </button>
                      <button type="button" className="ds-btn text-[11px]" onClick={() => setDiaryCharacter(character)}>
                        {t('sidepanel.characterPage.diaryAction')}
                      </button>
                      <button type="button" className="ds-btn text-[11px]" onClick={() => handleExportCard(character)}>
                        {t('sidepanel.characterPage.exportCard')}
                      </button>
                      <button
                        type="button"
                        className="ds-btn text-[11px]"
                        onClick={() => void handleDelete(character)}
                      >
                        {t('sidepanel.characterPage.delete')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function makeCharacterId(): string {
  return 'char-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

function makeGroupId(): string {
  return 'gal-group-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

const GROUP_EMPTY: Omit<GalGroup, 'id' | 'createdAt' | 'updatedAt' | 'projectId'> = {
  name: '',
  description: '',
  instructions: '',
  memberIds: [],
};

interface DiaryEntry {
  key: string;
  title: string;
  content: string;
  createdAt: number;
  source: 'character' | 'group';
  groupName?: string;
}

/** Character diary: this character's memories plus group chat events, merged into a timeline. */
function CharacterDiary({
  character,
  groups,
  onBack,
  t,
}: {
  character: GalCharacter;
  groups: GalGroup[];
  onBack: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    sidepanelRuntimeClient.request(
      { type: 'GET_MEMORIES' },
      { unavailableMessage: 'memory unavailable', acceptFailure: true, decode: (value) => value },
    )
      .then((all) => {
        if (cancelled) return;
        const list = Array.isArray(all) ? all as Memory[] : [];
        const myGroupIds = groups
          .filter((group) => group.memberIds.includes(character.id))
          .map((group) => group.id);
        const collected: DiaryEntry[] = [];
        for (const memory of list) {
          if (!memory) continue;
          const name = String(memory.name || '');
          if (memory.characterId === character.id) {
            collected.push({
              key: `c-${memory.id ?? name}`,
              title: name,
              content: String(memory.content || ''),
              createdAt: Number(memory.createdAt || 0),
              source: 'character',
            });
            continue;
          }
          if (!name.startsWith('gal-group:')) continue;
          const groupId = name.slice('gal-group:'.length).split('#')[0].split(/\s+/)[0];
          if (!myGroupIds.includes(groupId)) continue;
          const groupName = groups.find((group) => group.id === groupId)?.name || groupId;
          const lines = String(memory.content || '').split('\n');
          lines.forEach((line, index) => {
            const text = line.trim();
            if (!text) return;
            collected.push({
              key: `g-${memory.id ?? name}-${index}`,
              title: groupName,
              content: text,
              createdAt: Number(memory.updatedAt || memory.createdAt || 0),
              source: 'group',
              groupName,
            });
          });
        }
        setEntries(collected.sort((a, b) => b.createdAt - a.createdAt));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [character.id, groups]);

  const primary = 'var(--ds-text)';
  const secondary = 'var(--ds-text-secondary, #98a1c2)';
  const border = 'var(--ds-border, rgba(255,255,255,.1))';

  let lastDay = '';
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold" style={{ color: primary }}>
            📖 {t('sidepanel.characterPage.diaryTitle')} · {character.name}
          </h2>
          <p className="text-[11px]" style={{ color: secondary }}>
            {t('sidepanel.characterPage.diaryHint')}
          </p>
        </div>
        <button type="button" className="ds-btn text-[11px]" onClick={onBack}>←</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading ? (
          <SkeletonList rows={3} />
        ) : entries.length === 0 ? (
          <p className="text-[11px]" style={{ color: secondary }}>
            {t('sidepanel.characterPage.diaryEmpty')}
          </p>
        ) : entries.map((entry) => {
          const day = formatDay(entry.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={entry.key}>
              {showDay && (
                <div className="text-[10px] mt-2 mb-1" style={{ color: secondary }}>{day}</div>
              )}
              <div className="rounded-lg border p-2.5" style={{ borderColor: border }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium truncate" style={{ color: primary }}>
                    {entry.title}
                  </span>
                  {entry.source === 'group' && (
                    <span className="text-[9px] px-1 rounded" style={{ color: '#8f7bff', border: '1px solid rgba(143,123,255,.5)' }}>
                      {t('sidepanel.characterPage.diaryGroupPrefix')}
                    </span>
                  )}
                  <span className="text-[10px] ml-auto shrink-0" style={{ color: secondary }}>
                    {formatTime(entry.createdAt)}
                  </span>
                </div>
                <div className="text-[11px] whitespace-pre-wrap mt-1" style={{ color: secondary }}>
                  {entry.content.slice(0, 400)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDay(timestamp: number): string {
  const date = new Date(timestamp || 0);
  if (Number.isNaN(date.getTime())) return '—';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp || 0);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function GroupsList({
  groups,
  characters,
  onEdit,
  onDelete,
  t,
}: {
  groups: GalGroup[];
  characters: GalCharacter[];
  onEdit: (group: GalGroup) => void;
  onDelete: (group: GalGroup) => Promise<void>;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const primary = 'var(--ds-text)';
  const secondary = 'var(--ds-text-secondary, #98a1c2)';
  const border = 'var(--ds-border, rgba(255,255,255,.1))';
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
      <p className="text-[11px]" style={{ color: secondary }}>{t('sidepanel.characterPage.group.chatHint')}</p>
      {groups.length === 0 ? (
        <p className="text-[12px]" style={{ color: secondary }}>
          {t('sidepanel.characterPage.group.empty')}
          <br />
          {t('sidepanel.characterPage.group.emptyHelp')}
        </p>
      ) : groups.map((group) => (
        <div key={group.id} className="rounded-lg border p-3" style={{ borderColor: border }}>
          <div className="text-[13px] font-semibold" style={{ color: primary }}>{group.name}</div>
          {group.description && (
            <div className="text-[11px]" style={{ color: secondary }}>{group.description}</div>
          )}
          <div className="text-[10px] mt-1" style={{ color: secondary }}>
            {t('sidepanel.characterPage.group.memberCount', { count: group.memberIds.length })}
            {' · '}
            {group.memberIds.map(nameOf).join(' / ') || '—'}
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" className="ds-btn text-[11px]" onClick={() => onEdit(group)}>
              {t('sidepanel.characterPage.group.edit')}
            </button>
            <button type="button" className="ds-btn text-[11px]" onClick={() => void onDelete(group)}>
              {t('sidepanel.characterPage.group.delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupForm({
  existing,
  characters,
  onSave,
  onCancel,
  t,
}: {
  existing: GalGroup | null;
  characters: GalCharacter[];
  onSave: (draft: NewGalGroup, existingId: string | null) => Promise<void>;
  onCancel: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState(() => ({
    name: existing?.name ?? GROUP_EMPTY.name,
    description: existing?.description ?? '',
    instructions: existing?.instructions ?? '',
    memberIds: existing?.memberIds ? [...existing.memberIds] : [],
  }));
  const [saving, setSaving] = useState(false);

  const toggleMember = (id: string) => {
    setDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((item) => item !== id)
        : [...current.memberIds, id],
    }));
  };

  const submit = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        instructions: draft.instructions.trim(),
        memberIds: draft.memberIds,
      }, existing?.id ?? null);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    color: 'var(--ds-text)',
    borderColor: 'var(--ds-border, rgba(255,255,255,.15))',
    background: 'var(--ds-input-bg, rgba(255,255,255,.04))',
  } as const;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ds-text)' }}>
        {existing
          ? t('sidepanel.characterPage.group.form.editTitle')
          : t('sidepanel.characterPage.group.form.newTitle')}
      </h2>

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.group.form.nameLabel')}
        <input
          className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
          style={inputStyle}
          value={draft.name}
          onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
        />
      </label>

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.group.form.descriptionLabel')}
        <input
          className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
          style={inputStyle}
          value={draft.description}
          onChange={(event) => setDraft((c) => ({ ...c, description: event.target.value }))}
        />
      </label>

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.group.form.instructionsLabel')}
        <textarea
          className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[12px] min-h-[56px]"
          style={inputStyle}
          value={draft.instructions}
          onChange={(event) => setDraft((c) => ({ ...c, instructions: event.target.value }))}
        />
      </label>

      <div className="text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.group.form.membersLabel')}
        {characters.length === 0 ? (
          <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
            {t('sidepanel.characterPage.group.form.noMembers')}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {characters.map((character) => {
              const on = draft.memberIds.includes(character.id);
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => toggleMember(character.id)}
                  className="rounded-full px-2.5 py-1 text-[11px]"
                  style={{
                    color: on ? '#fff' : 'var(--ds-text)',
                    border: `1px solid ${on ? character.color || '#8f7bff' : 'var(--ds-border, rgba(255,255,255,.18))'}`,
                    background: on ? `${character.color || '#8f7bff'}33` : 'transparent',
                  }}
                >
                  {character.name}{on ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="rounded px-3 py-1.5 text-[12px] font-medium"
          style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
          disabled={saving || !draft.name.trim()}
          onClick={() => void submit()}
        >
          {t('sidepanel.characterPage.group.form.save')}
        </button>
        <button type="button" className="ds-btn text-[12px]" onClick={onCancel}>
          {t('sidepanel.characterPage.group.form.cancel')}
        </button>
      </div>
    </div>
  );
}

function Avatar({ character, size }: { character: GalCharacter; size: number }) {
  const color = character.color || '#8f7bff';
  if (character.avatar) {
    return (
      <img
        src={character.avatar}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover border"
        style={{ borderColor: color, width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full flex items-center justify-center text-[15px] font-bold"
      style={{ background: `${color}33`, color, width: size, height: size }}
    >
      {(character.name || '?').slice(0, 1)}
    </span>
  );
}

const EDIT_FIELDS: Array<{ key: keyof Omit<CharacterDraft, 'memoryTags' | 'name'>; labelKey: string }> = [
  { key: 'color', labelKey: 'colorLabel' },
  { key: 'avatar', labelKey: 'avatarLabel' },
  { key: 'description', labelKey: 'descriptionLabel' },
  { key: 'personality', labelKey: 'personalityLabel' },
  { key: 'scenario', labelKey: 'scenarioLabel' },
  { key: 'exampleDialogue', labelKey: 'exampleLabel' },
  { key: 'greeting', labelKey: 'greetingLabel' },
  { key: 'systemPrompt', labelKey: 'systemLabel' },
];

function CharacterForm({
  existing,
  onSave,
  onCancel,
  t,
}: {
  existing: GalCharacter | null;
  onSave: (draft: CharacterDraft, existingId: string | null) => Promise<void>;
  onCancel: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [draft, setDraft] = useState<CharacterDraft>(() => ({
    ...BLANK_FIELDS,
    ...(existing
      ? {
        name: existing.name,
        color: existing.color ?? '#8f7bff',
        avatar: existing.avatar ?? '',
        description: existing.description ?? '',
        personality: existing.personality ?? '',
        scenario: existing.scenario ?? '',
        exampleDialogue: existing.exampleDialogue ?? '',
        greeting: existing.greeting ?? '',
        systemPrompt: existing.systemPrompt ?? '',
        memoryTags: existing.memoryTags ?? [],
        affinity: existing.affinity ?? 0,
      }
      : {}),
  }));
  const [tagsText, setTagsText] = useState((draft.memoryTags ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const setField = (key: keyof CharacterDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await onSave(
        {
          ...draft,
          memoryTags: tagsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        },
        existing?.id ?? null,
      );
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    color: 'var(--ds-text)',
    borderColor: 'var(--ds-border, rgba(255,255,255,.15))',
    background: 'var(--ds-input-bg, rgba(255,255,255,.04))',
  } as const;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <h2 className="text-[14px] font-semibold" style={{ color: 'var(--ds-text)' }}>
        {existing
          ? t('sidepanel.characterPage.form.editTitle')
          : t('sidepanel.characterPage.form.newTitle')}
      </h2>

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.form.nameLabel')}
        <input
          className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
          style={inputStyle}
          value={draft.name}
          onChange={(event) => setField('name', event.target.value)}
        />
      </label>

      {EDIT_FIELDS.map(({ key, labelKey }) => {
        const isColor = key === 'color';
        return (
          <label key={key} className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
            {t(`sidepanel.characterPage.form.${labelKey}`)}
            {key === 'color' || key === 'avatar' ? (
              <input
                type={isColor ? 'color' : 'text'}
                className="mt-1 w-full rounded border bg-transparent px-2 py-1 text-[13px]"
                style={inputStyle}
                value={String(draft[key] ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            ) : (
              <textarea
                className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[12px] min-h-[56px]"
                style={inputStyle}
                value={String(draft[key] ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            )}
          </label>
        );
      })}

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.form.tagsLabel')}
        <input
          className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
          style={inputStyle}
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
        />
      </label>

      <label className="block text-[11px]" style={{ color: 'var(--ds-text-secondary, #98a1c2)' }}>
        {t('sidepanel.characterPage.form.affinityLabel')}
        <div className="flex items-center gap-2 mt-1">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(draft.affinity ?? 0)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              affinity: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
            }))}
            className="flex-1"
          />
          <span className="text-[12px] w-12 text-right" style={{ color: 'var(--ds-text)' }}>
            ❤️ {Math.round(draft.affinity ?? 0)}
          </span>
        </div>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="rounded px-3 py-1.5 text-[12px] font-medium"
          style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
          disabled={saving || !draft.name.trim()}
          onClick={() => void submit()}
        >
          {t('sidepanel.characterPage.form.save')}
        </button>
        <button type="button" className="ds-btn text-[12px]" onClick={onCancel}>
          {t('sidepanel.characterPage.form.cancel')}
        </button>
      </div>
    </div>
  );
}

function CharacterMemories({
  character,
  onBack,
  t,
}: {
  character: GalCharacter;
  onBack: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [globalCount, setGlobalCount] = useState(0);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(() => {
    sidepanelRuntimeClient.request(
      { type: 'GET_MEMORIES' },
      {
        unavailableMessage: 'memory unavailable',
        acceptFailure: true,
        decode: (value) => value,
      },
    )
      .then((all) => {
        const list = Array.isArray(all) ? all as Memory[] : [];
        setMemories(list.filter((m) => m && m.characterId === character.id));
        setGlobalCount(list.filter((m) => !m || !m.characterId).length);
      })
      .catch(() => setNote('memory unavailable'));
  }, [character.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = () => {
    if (!name.trim() && !content.trim()) return;
    sidepanelRuntimeClient.request(
      {
        type: 'SAVE_MEMORY',
        payload: {
          type: 'topic' as const,
          scope: 'global' as const,
          characterId: character.id,
          name: name.trim() || content.trim().slice(0, 24),
          content: content.trim() || name.trim(),
          description: '',
          tags: [character.name],
          pinned: false,
        },
      },
      { unavailableMessage: 'memory unavailable', acceptFailure: true, decode: (value) => value },
    ).then(() => {
      setName('');
      setContent('');
      reload();
    }).catch(() => setNote('memory unavailable'));
  };

  const globalize = (memory: Memory) => {
    sidepanelRuntimeClient.request(
      { type: 'UPDATE_MEMORY', payload: { ...memory, characterId: '' } },
      { unavailableMessage: 'memory unavailable', acceptFailure: true, decode: (value) => value },
    ).then(reload).catch(() => setNote('memory unavailable'));
  };

  const remove = (memory: Memory) => {
    if (!confirm(t('sidepanel.characterPage.deleteConfirm'))) return;
    sidepanelRuntimeClient.request(
      { type: 'DELETE_MEMORY', payload: { id: memory.id as number } },
      { unavailableMessage: 'memory unavailable', acceptFailure: true, decode: (value) => value },
    ).then(reload).catch(() => setNote('memory unavailable'));
  };

  const primary = 'var(--ds-text)';
  const secondary = 'var(--ds-text-secondary, #98a1c2)';
  const border = 'var(--ds-border, rgba(255,255,255,.1))';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold" style={{ color: primary }}>
            {t('sidepanel.characterPage.memory.title')} · {character.name}
          </h2>
          <p className="text-[11px]" style={{ color: secondary }}>{t('sidepanel.characterPage.memory.hint')}</p>
        </div>
        <button type="button" className="ds-btn text-[11px]" onClick={onBack}>←</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        <p className="text-[10px]" style={{ color: secondary }}>
          {t('sidepanel.characterPage.memory.globalCount', { count: globalCount })}
        </p>
        {memories.length === 0 ? (
          <p className="text-[11px]" style={{ color: secondary }}>{t('sidepanel.characterPage.memory.empty')}</p>
        ) : (
          memories.map((memory) => (
            <div key={memory.id} className="rounded-lg border p-2.5" style={{ borderColor: border }}>
              <div className="text-[12px] font-medium truncate" style={{ color: primary }}>
                {memory.name}
              </div>
              <div className="text-[11px] whitespace-pre-wrap line-clamp-3" style={{ color: secondary }}>
                {String(memory.content || '').slice(0, 200)}
              </div>
              <div className="flex gap-2 mt-1.5">
                <button type="button" className="ds-btn text-[10px]" onClick={() => globalize(memory)}>
                  {t('sidepanel.characterPage.memory.globalize')}
                </button>
                <button type="button" className="ds-btn text-[10px]" onClick={() => remove(memory)}>
                  {t('sidepanel.characterPage.memory.deleteMem')}
                </button>
              </div>
            </div>
          ))
        )}

        <div className="rounded-lg border p-2.5 space-y-2" style={{ borderColor: border }}>
          <input
            className="w-full rounded border bg-transparent px-2 py-1 text-[12px]"
            style={{ color: primary, borderColor: border }}
            placeholder={t('sidepanel.characterPage.memory.addNamePh')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            className="w-full rounded border bg-transparent px-2 py-1 text-[12px] min-h-[52px]"
            style={{ color: primary, borderColor: border }}
            placeholder={t('sidepanel.characterPage.memory.addContentPh')}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <button
            type="button"
            className="rounded px-3 py-1 text-[11px] font-medium"
            style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
            onClick={add}
          >
            {t('sidepanel.characterPage.memory.addBtn')}
          </button>
        </div>
        {note && <p className="text-[10px]" style={{ color: secondary }}>{note}</p>}
      </div>
    </div>
  );
}

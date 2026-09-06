import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalCharacter, GalCharacterCadence, GalSettings, Memory, NewGalCharacter } from '../../../core/types';
import { decodeGalCharacter, decodeGalCharacterCollection } from '../../../core/character/codec';
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
};

export default function CharacterPage() {
  const { t } = useI18n();
  const tk = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const [characters, setCharacters] = useState<GalCharacter[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<GalCharacter | null>(null);
  const [memoryCharacter, setMemoryCharacter] = useState<GalCharacter | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const fence = useRef(createRequestGenerationFence());

  const fail = useCallback((error: unknown) => {
    setStatusMessage(t('sidepanel.characterPage.operationFailed', {
      error: getRuntimeErrorMessage(error),
    }));
  }, [t]);

  const load = useCallback(async () => {
    const generation = fence.current.begin();
    try {
      const [list, active] = await Promise.all([
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
      ]);
      if (!fence.current.isCurrent(generation)) return;
      setCharacters(list);
      setActiveId(active?.id ?? null);
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
          description={t('sidepanel.characterPage.description')}
          meta={activeId ? t('sidepanel.characterPage.activeMeta') : undefined}
        />
        <button
          type="button"
          onClick={beginNew}
          className="mt-2 rounded px-3 py-1.5 text-[12px] font-medium"
          style={{ color: '#fff', background: 'linear-gradient(135deg,#8f7bff,#4f8cff)' }}
        >
          ＋ {t('sidepanel.characterPage.create')}
        </button>
      </div>

      {view === 'edit' ? (
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

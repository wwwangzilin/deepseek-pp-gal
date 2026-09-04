import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeRuntimeResponse } from '../core/messaging/runtime-response';
import { decodeActivePreset } from '../core/preset/codec';
import { LEGACY_PRESET } from './fixtures/persistence-contract/skill-preset-history';

const content = readFileSync('entrypoints/content.ts', 'utf8');
const presetPage = readFileSync('entrypoints/sidepanel/pages/PresetPage.tsx', 'utf8');
const skillPage = readFileSync('entrypoints/sidepanel/pages/SkillPage.tsx', 'utf8');
const toolResultRenderer = readFileSync('core/ui/tool-result-renderer.ts', 'utf8');

describe('remaining local-state receiving boundaries', () => {
  it('decodes complete Content Skill/Preset snapshots before committing them', () => {
    expect(content).toMatch(/decodeSkillLibrary\(message\.skills,\s*['"]skillUpdate['"]\)/);
    expect(content).toMatch(/decodeActivePreset\(message\.activePreset,\s*['"]activePresetUpdate['"]\)/);
    expect(content).toMatch(/sendRuntimeMessageStrict<unknown>\(\{\s*type:\s*['"]GET_SKILLS['"],?\s*\}\)/);
    expect(content).toMatch(/\{\s*type:\s*['"]GET_ACTIVE_PRESET['"]\s*\},/);
    expect(content).toMatch(/\(value\) =>\s*decodeActivePreset\(value,\s*['"]activePresetResponse['"]\)/);
    expect(content).not.toContain("sendRuntimeMessage<Skill[]>({ type: 'GET_SKILLS' })");
  });

  it('keeps Side Panel state behind strict response and domain-codec boundaries', () => {
    expect(presetPage).toContain('decodeRuntimeResponse(');
    expect(presetPage).toContain("decodePresetCollection(");
    expect(presetPage).toContain("decodeActivePreset(");
    expect(presetPage).not.toContain('setPresets(list ?? [])');

    expect(skillPage).toContain("decodeSkillLibrary(");
    expect(skillPage).toContain("decodeSkillSourceCollection(");
    expect(skillPage).not.toContain('setSkills(list ?? [])');
    expect(skillPage).not.toContain('setSkillSources(sources ?? [])');
    expect(skillPage).not.toContain('key={source.id}');
    expect(skillPage).toContain('key={`${source.id}:${index}`}');
  });

  it('does not report an undefined Skill-draft response as persisted success', () => {
    expect(toolResultRenderer).toContain('if (result?.ok !== true)');
  });

  it('decodes a valid active Preset before interpreting its additive ok field as a runtime envelope', () => {
    const preset = { ...LEGACY_PRESET, ok: false, error: 'additive data' };

    expect(decodeRuntimeResponse(
      preset,
      (value) => decodeActivePreset(value, 'activePresetResponse'),
      'missing',
    )).toEqual(preset);
    expect(() => decodeRuntimeResponse(
      { ok: false, error: 'backend failed' },
      (value) => decodeActivePreset(value, 'activePresetResponse'),
      'missing',
    )).toThrow('backend failed');
  });
});

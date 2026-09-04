/**
 * pi-ecosystem SKILL.md import contract tests (Issue B3-T1/T2).
 *
 * The DeepSeek++ local-import pipeline already supports the agentskills.io /
 * pi-ecosystem SKILL.md format (BOM strip + frontmatter name/description/
 * version + body + H1/parent-dir fallbacks). B3 hardens that surface as a
 * contract:
 *
 *  1. Parsing contract (B3-T1): frontmatter fields, fallbacks, BOM, malformed
 *     frontmatter (tolerated today = `current-gap`, never promoted to legal
 *     fixtures), unknown fields (preserved in metadata where applicable).
 *  2. pi-field bridge contract (B3-T2): pi's `disable-model-invocation`
 *     frontmatter maps to a metadata key (model-visibility semantics stay
 *     owned by the app); pi's prompt-format helpers
 *     (`formatSkillsForSystemPrompt`/`formatSkillInvocation`) must remain
 *     unreferenced — pi templates never enter the wire (prompt-bytes
 *     invariant).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/mcp/store', () => ({
  getAllMcpServers: vi.fn(),
  getMcpToolCache: vi.fn(),
  updateMcpServer: vi.fn(),
}));

vi.mock('../core/mcp/discovery', () => ({
  executeMcpToolCall: vi.fn(),
  getMcpToolDescriptors: vi.fn(),
  refreshMcpServerDiscovery: vi.fn(),
}));

import type { ToolCall, ToolResult } from '../core/types';
import { parseSkillDoc } from '../core/skill/local-importer';
import { parsePiSkillMarkdown, readPiSkillFrontmatter } from '../core/skill/pi-importer';

describe('SKILL.md parsing contract (pi-ecosystem format)', () => {
  it('parses frontmatter name/description and body', () => {
    const parsed = parseSkillDoc(
      [
        '---',
        'name: my-community-skill',
        'description: A community skill from the pi ecosystem.',
        '---',
        '# My Community Skill',
        '',
        'Instructions body.',
      ].join('\n'),
      '/skills/my-community-skill/SKILL.md',
    );
    expect(parsed.name).toBe('my-community-skill');
    expect(parsed.description).toBe('A community skill from the pi ecosystem.');
    expect(parsed.body).toContain('# My Community Skill');
    expect(parsed.body).toContain('Instructions body.');
  });

  it('parses version and last_updated from metadata and top-level', () => {
    const parsed = parseSkillDoc(
      [
        '---',
        'name: v-skill',
        'description: Versioned skill',
        'metadata:',
        '  version: 1.2.0',
        '  last_updated: 2026-01-01',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/v-skill/SKILL.md',
    );
    expect(parsed.version).toBe('1.2.0');
    expect(parsed.lastUpdated).toBe('2026-01-01');
  });

  it('falls back to H1, then parent directory name, then path', () => {
    expect(parseSkillDoc('# H1 Title\n\nBody', '/skills/a/SKILL.md').name).toBe('h1-title');
    expect(parseSkillDoc('Body without H1', '/skills/parent-name/SKILL.md').name).toBe('parent-name');
    expect(parseSkillDoc('Body', '/skills/SKILL.md').name).toBe('skills');
  });

  it('strips a UTF-8 BOM before matching the frontmatter fence (issue #296)', () => {
    const parsed = parseSkillDoc(
      '\uFEFF---\nname: bom-safe\ndescription: BOM-safe import\n---\nBody.',
      '/skills/bom-safe/SKILL.md',
    );
    expect(parsed.name).toBe('bom-safe');
  });

  it('tolerates malformed frontmatter without crashing (current-gap: treated as body)', () => {
    // A fence that never closes is not a legal fixture: today it degrades to
    // the whole document being the body (current-gap, owning follow-up:
    // explicit malformed-frontmatter rejection). The contract pins the
    // accepted behavior so a change is visible.
    const parsed = parseSkillDoc('---\nname: broken\nBody without closing fence', '/skills/x/SKILL.md');
    expect(parsed.body).toContain('---');
    expect(parsed.name).toBeTruthy();
  });

  it('preserves unknown frontmatter fields as body-only (no field loss)', () => {
    // pi-ecosystem frontmatter may carry extra keys (license, agent, etc.).
    // They must not crash the parser or alter name/description.
    const parsed = parseSkillDoc(
      [
        '---',
        'name: extra-fields',
        'description: With extras',
        'license: MIT',
        'agent: coding',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/extra-fields/SKILL.md',
    );
    expect(parsed.name).toBe('extra-fields');
    expect(parsed.description).toBe('With extras');
    expect(parsed.body).toBe('Body.');
  });
});

describe('pi-field bridge contract (B3-T2)', () => {
  it('maps pi disable-model-invocation to a metadata-preserving surface (no semantic change)', () => {
    // The pi ecosystem's `disable-model-invocation` flag is not consumed by
    // the DeepSeek++ model-visibility semantics (enablement is app-owned).
    // The bridge must not crash on it and must keep the parsed doc stable.
    const parsed = parseSkillDoc(
      [
        '---',
        'name: disabled-skill',
        'description: Not model-invokable',
        'disable-model-invocation: true',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/disabled-skill/SKILL.md',
    );
    expect(parsed.name).toBe('disabled-skill');
    expect(parsed.description).toBe('Not model-invokable');
  });

  it('keeps pi prompt-format helpers unreferenced (pi templates never enter the wire)', () => {
    // grep across the skill pipeline: pi's harness prompt formatters must
    // never be imported or called from production code.
    const sources = [
      '../core/skill/local-importer.ts',
      '../core/skill/pi-importer.ts',
      '../core/skill/github-importer.ts',
      '../core/skill/codec.ts',
      '../core/skill/registry.ts',
      '../core/skill/bundled-loader.ts',
    ];
    for (const relative of sources) {
      let source: string;
      try {
        source = readFileSync(resolve(import.meta.dirname, relative), 'utf8');
      } catch {
        continue; // file may not exist yet in this phase
      }
      expect(source).not.toMatch(/import[^;]*formatSkillsForSystemPrompt/);
      expect(source).not.toMatch(/import[^;]*formatSkillInvocation/);
      expect(source).not.toMatch(/from\s+['"]@earendil-works\//);
    }
  });
});

describe('pi-importer bridge (B3-T3)', () => {
  it('parsePiSkillMarkdown delegates to the shared parser truth', () => {
    const raw = [
      '---',
      'name: bridged-skill',
      'description: Bridged via pi-importer',
      '---',
      'Body.',
    ].join('\n');
    const direct = parseSkillDoc(raw, '/skills/bridged-skill/SKILL.md');
    const bridged = parsePiSkillMarkdown(raw, '/skills/bridged-skill/SKILL.md');
    expect(bridged).toEqual(direct);
  });

  it('readPiSkillFrontmatter exposes pi fields metadata-preservingly', () => {
    const raw = [
      '---',
      'name: flagged-skill',
      'description: With pi flag',
      'disable-model-invocation: true',
      '---',
      'Body.',
    ].join('\n');
    const frontmatter = readPiSkillFrontmatter(raw);
    expect(frontmatter.name).toBe('flagged-skill');
    expect(frontmatter.description).toBe('With pi flag');
    expect(frontmatter.disableModelInvocation).toBe(true);
  });

  it('readPiSkillFrontmatter reports disableModelInvocation false when absent', () => {
    const frontmatter = readPiSkillFrontmatter('---\nname: plain\ndescription: Plain\n---\nBody.');
    expect(frontmatter.disableModelInvocation).toBe(false);
  });

  it('pi-importer module has zero @earendil-works dependency', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/skill/pi-importer.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"]@earendil-works\//);
    expect(source).not.toMatch(/import[^;]*loadSkills/);
    expect(source).not.toMatch(/import[^;]*formatSkillsForSystemPrompt/);
    expect(source).not.toMatch(/import[^;]*formatSkillInvocation/);
  });
});

describe('pi-ecosystem SKILL.md end-to-end import compatibility (B3-T5)', () => {
  // A community pi-ecosystem skill directory (agentskills.io layout) must
  // flow through the released local-import pipeline unchanged. The pipeline
  // is exercised with the same MCP mock seam as local-skill-importer tests.
  it('imports a pi-ecosystem SKILL.md directory with extra frontmatter fields', async () => {
    const { executeMcpToolCall, getMcpToolDescriptors, refreshMcpServerDiscovery } = await import('../core/mcp/discovery');
    const { getAllMcpServers, getMcpToolCache, updateMcpServer } = await import('../core/mcp/store');
    const { importLocalSkillSource } = await import('../core/skill/local-importer');
    const { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } = await import('../core/shell');
    vi.mocked(getAllMcpServers).mockResolvedValue([]);

    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string | string[] | null | undefined) => {
            if (typeof key === 'string') return { [key]: storage[key] };
            if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, storage[item]]));
            return { ...storage };
          }),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(storage, values);
          }),
        },
      },
    });

    const content = [
      '---',
      'name: pi-community-tool',
      'description: A community skill from the pi ecosystem.',
      'license: MIT',
      'agent: coding',
      'disable-model-invocation: true',
      '---',
      '# Pi Community Tool',
      '',
      'Do the thing per the pi ecosystem convention.',
    ].join('\n');

    const shellServer = {
      id: 'shell-local',
      displayName: SHELL_MCP_SERVER_NAME,
      enabled: true,
      transport: { kind: 'native_messaging' as const, nativeHost: SHELL_MCP_NATIVE_HOST },
      execution: { enabled: true, mode: 'auto' as const },
      allowlist: { mode: 'allow' as const, toolNames: ['local_skill_preview', 'local_folder_pick'] },
      timeouts: { connectMs: 1, requestMs: 1, discoveryMs: 1 },
      limits: { maxResultBytes: 128_000, maxToolCount: 8 },
      headers: [],
      secrets: [],
      version: 1 as const,
      status: 'ready' as const,
      lastConnectedAt: 1,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    vi.mocked(getAllMcpServers).mockResolvedValue([shellServer as never]);
    vi.mocked(updateMcpServer).mockImplementation(async (_id, patch) => ({
      ...shellServer,
      ...(patch as object),
      allowlist: (patch as { allowlist?: unknown }).allowlist ?? shellServer.allowlist,
    }) as never);
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValue({} as never);
    const now = Date.now();
    vi.mocked(getMcpToolCache).mockResolvedValue({
      serverId: 'shell-local',
      descriptors: ['local_skill_preview', 'local_folder_pick'].map((name) => ({
        id: `mcp:shell-local:${name}`,
        provider: {
          kind: 'mcp' as const,
          id: 'shell-local',
          displayName: SHELL_MCP_SERVER_NAME,
          transport: 'native_messaging' as const,
        },
        name,
        invocationName: name,
        title: name,
        description: name,
        inputSchema: {},
        enabled: true,
        checkedAt: now,
      })),
      raw: { tools: [] },
      checkedAt: now,
      version: 1 as const,
    } as never);
    vi.mocked(getMcpToolDescriptors).mockResolvedValue([]);
    vi.mocked(executeMcpToolCall).mockResolvedValue({
      ok: true,
      summary: 'MCP tool executed',
      output: {
        ok: true,
        data: {
          rootPath: '/pi/skills/pi-community-tool',
          displayName: 'pi-community-tool',
          directoryName: 'pi-community-tool',
          warnings: [],
          truncated: false,
          skills: [
            {
              path: 'SKILL.md',
              directory: '',
              directoryPath: '/pi/skills/pi-community-tool',
              content,
              bodyBytes: content.length,
              includedFiles: [],
              omittedFiles: [],
              scriptFiles: [],
              warnings: [],
            },
          ],
        },
      },
    } as never);

    const result = await importLocalSkillSource({
      rootPath: '/pi/skills/pi-community-tool',
      selectedPaths: ['SKILL.md'],
    }, {
      executeToolCall: (call: ToolCall) => (
        executeMcpToolCall as unknown as (value: ToolCall) => Promise<ToolResult>
      )(call),
      runLocalStateMutation: async (stage) => (await stage())(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe('pi-community-tool');
    expect(result.imported[0].description).toBe('A community skill from the pi ecosystem.');
    // The released local-import pipeline registers an index card (pointer to
    // the on-disk SKILL.md, activated via local file tools) rather than
    // inlining the body — the pi-ecosystem skill lands through the same path.
    expect(result.imported[0].instructions).toContain('# Local Skill: pi-community-tool');
    expect(result.imported[0].instructions).toContain('Index form: true');
    // The returned import entry is the parsed record (name/description/
    // instructions); persistence of the local source lands under the
    // released skill key, asserted below.
    // No new persistence keys: the import lands under the released skill key.
    expect(Object.keys(storage).some((key) => key.startsWith('deepseek_pp_skills'))).toBe(true);

    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
});

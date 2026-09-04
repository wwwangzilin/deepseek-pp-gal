import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewGitHubSkillSource } from '../core/skill/github-importer';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | null | undefined) => {
          if (typeof key === 'string') return { [key]: storage[key] };
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, storage[item]]));
          return { ...storage };
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('GitHub Skill importer', () => {
  it('loads Skill files from raw GitHub content without per-file contents API calls', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;

      if (url === 'https://api.github.com/repos/owner/repo') {
        return jsonResponse({
          full_name: 'owner/repo',
          html_url: 'https://github.com/owner/repo',
          default_branch: 'main',
          description: null,
          license: null,
        });
      }
      if (url === 'https://api.github.com/repos/owner/repo/commits/main') {
        return jsonResponse({ sha: commitSha });
      }
      if (url === 'https://api.github.com/repos/owner/repo/git/trees/main?recursive=1') {
        return jsonResponse({
          sha: 'tree-sha',
          truncated: false,
          tree: [
            {
              path: 'skills/demo/SKILL.md',
              mode: '100644',
              type: 'blob',
              sha: 'skill-sha',
              size: 96,
              url: '',
            },
            {
              path: 'skills/demo/references/guide.md',
              mode: '100644',
              type: 'blob',
              sha: 'guide-sha',
              size: 24,
              url: '',
            },
          ],
        });
      }
      if (url.endsWith('/.codex-plugin/plugin.json') || url.endsWith('/.claude-plugin/plugin.json') || url.endsWith('/package.json')) {
        return new Response('', { status: 404 });
      }
      if (url === `https://raw.githubusercontent.com/owner/repo/${commitSha}/skills/demo/SKILL.md`) {
        return textResponse([
          '---',
          'name: demo',
          'description: Demo Skill',
          '---',
          '',
          '# Demo',
          '',
          'Read references/guide.md before use.',
        ].join('\n'));
      }
      if (url === `https://raw.githubusercontent.com/owner/repo/${commitSha}/skills/demo/references/guide.md`) {
        return textResponse('Guide content');
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const preview = await previewGitHubSkillSource('https://github.com/owner/repo');

    expect(preview.skills).toHaveLength(1);
    expect(preview.skills[0]).toMatchObject({
      path: 'skills/demo/SKILL.md',
      importName: 'demo',
      includedFiles: [{ path: 'skills/demo/references/guide.md', bytes: 13 }],
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/contents/'))).toBe(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

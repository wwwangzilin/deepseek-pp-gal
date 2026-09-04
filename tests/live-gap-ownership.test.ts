import { describe, expect, it } from 'vitest';
import { DEEPSEEK_SSE_CURRENT_GAPS } from './fixtures/external-runtime/deepseek';
import { INSTALLER_CURRENT_GAPS } from './fixtures/external-runtime/installer';
import { MCP_CURRENT_GAPS } from './fixtures/external-runtime/mcp';
import { PLATFORM_CURRENT_GAPS } from './fixtures/external-runtime/platform';
import { RUNTIME_CURRENT_GAPS } from './fixtures/runtime-contract/runtime';

describe('live compatibility gap ownership', () => {
  it('removes gaps closed by the active batch', () => {
    expect(MCP_CURRENT_GAPS).toEqual([]);
    expect(PLATFORM_CURRENT_GAPS).toEqual([]);
    expect(RUNTIME_CURRENT_GAPS).toEqual([]);
  });

  it('gives every retained gap an explicit non-historical deferred owner', () => {
    const retainedGaps = [
      ...DEEPSEEK_SSE_CURRENT_GAPS,
      ...INSTALLER_CURRENT_GAPS,
    ];

    expect(retainedGaps.length).toBeGreaterThan(0);
    for (const gap of retainedGaps) {
      expect(gap.status, gap.name).toBe('deferred');
      expect(gap.owner, gap.name).toMatch(/^deferred:[a-z0-9-]+$/);
      expect(gap.target, gap.name).not.toMatch(/(?:after|in)-(?:T|R)\d/i);
    }
  });
});

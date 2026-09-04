import { describe, expect, it } from 'vitest';
import {
  filterRetiredModelFacingTools,
  isRetiredModelFacingTool,
} from '../core/tool/model-facing';
import { createArtifactToolDescriptors } from '../core/artifact';
import { createMemoryToolDescriptors } from '../core/tool/memory';
import { createWebSearchToolDescriptors } from '../core/tool/web-search';

describe('filterRetiredModelFacingTools', () => {
  it('removes the retired artifact tools from the model-facing list', () => {
    const descriptors = [
      ...createMemoryToolDescriptors('en'),
      ...createArtifactToolDescriptors('en'),
      ...createWebSearchToolDescriptors('en'),
    ];

    const filtered = filterRetiredModelFacingTools(descriptors);

    expect(filtered.map((descriptor) => descriptor.name)).toEqual([
      'memory_save',
      'memory_update',
      'memory_delete',
      'web_search',
      'web_fetch',
    ]);
    expect(isRetiredModelFacingTool(createArtifactToolDescriptors('en')[0])).toBe(true);
    expect(isRetiredModelFacingTool(createMemoryToolDescriptors('en')[0])).toBe(false);
  });

  it('keeps unrelated descriptors byte-for-byte', () => {
    const descriptors = createWebSearchToolDescriptors('en');
    expect(filterRetiredModelFacingTools(descriptors)).toEqual(descriptors);
    expect(filterRetiredModelFacingTools([])).toEqual([]);
  });
});

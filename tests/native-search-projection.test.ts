import { describe, expect, it } from 'vitest';
import {
  createDefaultToolDescriptors,
  isExtensionOwnedBrowserControlDescriptor,
  isExtensionOwnedWebFetchDescriptor,
  isExtensionOwnedWebSearchDescriptor,
  projectToolDescriptorsForNativeSearch,
} from '../core/tool';
import { createBrowserControlToolDescriptors } from '../core/browser-control/tool';
import type { ToolDescriptor } from '../core/types';

describe('projectToolDescriptorsForNativeSearch', () => {
  it('returns the descriptors unchanged when native search is disabled', () => {
    const descriptors = createDefaultToolDescriptors('en');

    const projected = projectToolDescriptorsForNativeSearch(descriptors, false);

    expect(projected).toBe(descriptors);
    expect(projected).toEqual([...descriptors]);
    expect(projected.map((descriptor) => descriptor.id)).toEqual(
      descriptors.map((descriptor) => descriptor.id),
    );
  });

  it('removes all extension-owned networking tools when native search is enabled', () => {
    const descriptors = [
      ...createDefaultToolDescriptors('en'),
      ...createBrowserControlToolDescriptors('en'),
    ];

    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    const names = projected.map((descriptor) => descriptor.name);
    expect(names).toEqual(['memory_save', 'memory_update', 'memory_delete']);
  });

  it('preserves descriptor order for the remaining descriptors', () => {
    const descriptors = createDefaultToolDescriptors('en');
    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(projected.map((descriptor) => descriptor.id)).toEqual([
      'local:memory:memory_save',
      'local:memory:memory_update',
      'local:memory:memory_delete',
    ]);
  });

  it('does not mutate the input descriptor array', () => {
    const descriptors = [...createDefaultToolDescriptors('en')];
    const snapshot = [...descriptors];

    projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(descriptors).toEqual(snapshot);
  });

  it('does not remove MCP descriptors that merely share web_/browser_ names', () => {
    const mcpBrowser = {
      ...mcpWebSearchDescriptor(),
      id: 'mcp:browser-tools:browser_navigate',
      name: 'browser_navigate',
      invocationName: 'browser_tools_browser_navigate',
    };
    const descriptors = [
      createDefaultToolDescriptors('en')[0],
      mcpWebSearchDescriptor(),
      mcpBrowser,
    ];

    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(projected.map((descriptor) => descriptor.id)).toEqual([
      'local:memory:memory_save',
      'mcp:browser-tools:web_search',
      'mcp:browser-tools:browser_navigate',
    ]);
    expect(isExtensionOwnedBrowserControlDescriptor(mcpBrowser as never)).toBe(false);
  });

  it('identifies the local extension web_search by provider contract rather than name alone', () => {
    expect(isExtensionOwnedWebSearchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_search')!)).toBe(true);
    expect(isExtensionOwnedWebSearchDescriptor(mcpWebSearchDescriptor())).toBe(false);
    expect(isExtensionOwnedWebSearchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_fetch')!)).toBe(false);

    expect(isExtensionOwnedWebFetchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_fetch')!)).toBe(true);
    expect(isExtensionOwnedWebFetchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_search')!)).toBe(false);
    expect(isExtensionOwnedWebFetchDescriptor(mcpWebSearchDescriptor())).toBe(false);

    expect(isExtensionOwnedBrowserControlDescriptor(
      createBrowserControlToolDescriptors('en')[0],
    )).toBe(true);
    expect(isExtensionOwnedBrowserControlDescriptor(
      createDefaultToolDescriptors('en').find((descriptor) => descriptor.name === 'web_search')!,
    )).toBe(false);
  });
});

function mcpWebSearchDescriptor(): ToolDescriptor {
  return {
    id: 'mcp:browser-tools:web_search',
    provider: {
      kind: 'mcp',
      id: 'browser-tools',
      displayName: 'Browser Tools',
      transport: 'streamable_http',
    },
    name: 'web_search',
    invocationName: 'browser_tools_web_search',
    title: 'Search (MCP)',
    description: 'A hypothetical MCP tool named web_search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}

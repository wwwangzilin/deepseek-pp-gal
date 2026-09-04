import { describe, expect, it } from 'vitest';
import {
  createMemoryToolDescriptors,
  executeMemoryToolCall,
  type MemoryToolRuntime,
} from '../core/tool/memory';
import {
  createWebSearchToolDescriptors,
  executeWebSearchToolCall,
} from '../core/tool/web-search';
import type { ToolCall } from '../core/tool/types';

function memorySaveCall(payload: Record<string, unknown>): ToolCall {
  return {
    name: 'memory_save',
    payload,
    raw: '<memory_save />',
  };
}

function schemaPropertyDescription(
  descriptor: ReturnType<typeof createMemoryToolDescriptors>[number] | ReturnType<typeof createWebSearchToolDescriptors>[number],
  propertyName: string,
): string {
  const property = descriptor.inputSchema.properties?.[propertyName];
  if (!property || typeof property !== 'object' || Array.isArray(property)) {
    throw new Error(`Missing schema property ${propertyName}`);
  }
  const description = property.description;
  if (typeof description !== 'string') {
    throw new Error(`Missing schema description for ${propertyName}`);
  }
  return description;
}

describe('memory tool validation', () => {
  it('localizes memory descriptors without changing tool protocol names', () => {
    const english = createMemoryToolDescriptors('en');
    const chinese = createMemoryToolDescriptors('zh-CN');

    expect(english[0].name).toBe('memory_save');
    expect(english[0].invocationName).toBe('memory_save');
    expect(english[0].title).toBe('Save memory');
    expect(schemaPropertyDescription(english[0], 'type')).toContain('Memory type');

    expect(chinese[0].name).toBe('memory_save');
    expect(chinese[0].invocationName).toBe('memory_save');
    expect(chinese[0].title).toBe('保存记忆');
    expect(schemaPropertyDescription(chinese[0], 'type')).toContain('记忆类型');
  });

  it('does not persist invalid memory_save payloads', async () => {
    let saveCalls = 0;
    const runtime: MemoryToolRuntime = {
      async saveMemory() {
        saveCalls++;
        return { id: 1 };
      },
      async getMemoryById() {
        return null;
      },
      async updateMemory() {},
      async deleteMemory() {},
    };

    const result = await executeMemoryToolCall(runtime, memorySaveCall({
      type: 'topic',
      name: '',
      content: 'content',
      tags: [],
    }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('memory_invalid_payload');
    expect(saveCalls).toBe(0);
  });

  it('returns localized memory validation errors', async () => {
    let saveCalls = 0;
    const runtime: MemoryToolRuntime = {
      async saveMemory() {
        saveCalls++;
        return { id: 1 };
      },
      async getMemoryById() {
        return null;
      },
      async updateMemory() {},
      async deleteMemory() {},
    };

    const english = await executeMemoryToolCall(runtime, memorySaveCall({
      type: 'topic',
      name: '',
      content: 'content',
      tags: [],
    }), 'en');

    const chinese = await executeMemoryToolCall(runtime, memorySaveCall({
      type: 'topic',
      name: '',
      content: 'content',
      tags: [],
    }), 'zh-CN');

    expect(english.summary).toBe('Invalid memory payload');
    expect(english.detail).toBe('name must be a non-empty string');
    expect(chinese.summary).toBe('记忆格式错误');
    expect(chinese.detail).toBe('name 必须是非空字符串');
    expect(saveCalls).toBe(0);
  });

  it('returns localized memory success summaries', async () => {
    const runtime: MemoryToolRuntime = {
      async saveMemory() {
        return { id: 42 };
      },
      async getMemoryById() {
        return null;
      },
      async updateMemory() {},
      async deleteMemory() {},
    };

    const result = await executeMemoryToolCall(runtime, memorySaveCall({
      type: 'topic',
      name: 'Pinned decision',
      content: 'Keep tool names stable.',
      tags: ['i18n'],
    }), 'en');

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Saved');
    expect(result.detail).toBe('Pinned decision');
  });
});

describe('web tool localization', () => {
  it('localizes web descriptors without changing tool protocol names', () => {
    const english = createWebSearchToolDescriptors('en');
    const chinese = createWebSearchToolDescriptors('zh-CN');

    expect(english[0].name).toBe('web_search');
    expect(english[0].invocationName).toBe('web_search');
    expect(english[0].title).toBe('Search the web');
    expect(schemaPropertyDescription(english[0], 'query')).toBe('Search query keywords');

    expect(chinese[0].name).toBe('web_search');
    expect(chinese[0].invocationName).toBe('web_search');
    expect(chinese[0].title).toBe('搜索互联网');
    expect(schemaPropertyDescription(chinese[0], 'query')).toBe('搜索查询关键词');
  });

  it('returns localized web validation errors without network access', async () => {
    const englishSearch = await executeWebSearchToolCall({
      name: 'web_search',
      payload: { query: '' },
      raw: '<web_search />',
    }, 'en');

    const chineseSearch = await executeWebSearchToolCall({
      name: 'web_search',
      payload: { query: '' },
      raw: '<web_search />',
    }, 'zh-CN');

    const englishFetch = await executeWebSearchToolCall({
      name: 'web_fetch',
      payload: { url: '' },
      raw: '<web_fetch />',
    }, 'en');

    expect(englishSearch.summary).toBe('Search query cannot be empty');
    expect(chineseSearch.summary).toBe('搜索查询不能为空');
    expect(englishFetch.summary).toBe('URL cannot be empty');
  });
});

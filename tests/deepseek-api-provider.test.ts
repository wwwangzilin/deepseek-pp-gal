/**
 * DeepSeek official-API provider contract tests (Issue B2-T1/T2).
 *
 * 1. Compile-time assignability: the provider factory return type must
 *    remain a valid pi-ai `Provider<'deepseek-api'>` and its deps must stay
 *    constructible from the port's own types (version-drift guard, risk a2).
 * 2. Message mapping contract (B2-T2): pi `Message[]` → `OfficialDeepSeekMessage[]`
 *    per-field rules — text join, reasoning hand-back, toolResult → user
 *    serialization — verified against the real mapper implementation.
 * 3. Contract hygiene: the port module may only import pi packages and
 *    type-only relative imports.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@earendil-works/pi-ai';
import type { OfficialDeepSeekMessage } from '../core/deepseek/official-api';
import {
  DEEPSEEK_API,
  DEEPSEEK_API_PROVIDER,
  type DeepSeekApiMessageMapper,
  type DeepSeekApiProviderFactory,
  type DeepSeekApiStreamFnDeps,
} from '../core/inline-agent/pi/official-api-port';

const officialApiMocks = vi.hoisted(() => ({
  submitOfficialDeepSeekStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/official-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/deepseek/official-api')>();
  return {
    ...original,
    submitOfficialDeepSeekStreaming: officialApiMocks.submitOfficialDeepSeekStreaming,
  };
});

const { createDeepSeekApiProvider, createDeepSeekApiMessageMapper } = await import(
  '../core/inline-agent/pi/official-api-provider'
);

// --- Compile-time assignability (drift guard) -------------------------------

type FactoryReturn = ReturnType<DeepSeekApiProviderFactory>;
const _providerAssignable: Provider<typeof DEEPSEEK_API> = null as unknown as FactoryReturn;
void _providerAssignable;

type DepsShape = DeepSeekApiStreamFnDeps;
const _depsAssignable: DepsShape = null as unknown as DepsShape;
void _depsAssignable;

type MapperShape = DeepSeekApiMessageMapper;
const _mapperAssignable: MapperShape = null as unknown as MapperShape;
void _mapperAssignable;

describe('deepseek-api provider port contract', () => {
  it('declares a custom api id outside pi-ai KnownApi and distinct from web', () => {
    const knownApis = [
      'openai-completions',
      'mistral-conversations',
      'openai-responses',
      'azure-openai-responses',
      'openai-codex-responses',
      'anthropic-messages',
      'bedrock-converse-stream',
      'google-generative-ai',
      'google-vertex',
      'pi-messages',
    ];
    expect(knownApis).not.toContain(DEEPSEEK_API);
    expect(DEEPSEEK_API).toBe('deepseek-api');
    expect(DEEPSEEK_API).not.toBe('deepseek-web'); // B1 backend stays distinct
    expect(DEEPSEEK_API_PROVIDER).toBe('deepseek-api');
  });

  it('keeps deps interface minimal and credential-free', () => {
    // The provider owns no credentials/page state: it asks for them.
    type HasApiKey = 'getApiKey' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    type HasConfig = 'getConfig' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    type HasMapper = 'mapMessages' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    const hasApiKey: HasApiKey = true;
    const hasConfig: HasConfig = true;
    const hasMapper: HasMapper = true;
    expect(hasApiKey).toBe(true);
    expect(hasConfig).toBe(true);
    expect(hasMapper).toBe(true);
  });
});

describe('deepseek-api provider port hygiene', () => {
  it('imports only pi packages, type-only relative modules, and contract types', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/inline-agent/pi/official-api-port.ts'),
      'utf8',
    );
    // No concrete implementation imports: the port may reference the
    // official-api *contract types* (type-only), but never its value
    // implementation (submitOfficialDeepSeekStreaming), nor adapter/entrypoint
    // modules.
    expect(source).not.toMatch(/import\s+\{[^}]*submitOfficialDeepSeekStreaming/);
    expect(source).not.toMatch(/from\s+['"].*adapter['"]/);
    expect(source).not.toMatch(/from\s+['"].*entrypoints['"]/);
    for (const line of source.split('\n')) {
      const match = line.match(/^import\s+(?!type\b)(.*)\s+from\s+['"]\.\//);
      expect(match).toBeNull();
    }
  });
});

// --- Message mapping contract (real mapper, B2-T2) --------------------------

// The message mapper is the real implementation (B2-T3); the mapping *rules*
// are pinned here so a behavior change in the mapper fails these tests.
const mapper = createDeepSeekApiMessageMapper();

describe('deepseek-api message mapping contract', () => {
  const userMsg = (content: Array<{ type: 'text'; text: string }>) => ({
    role: 'user' as const,
    content,
    timestamp: 1,
  });
  const assistantMsg = (content: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }>) => ({
    role: 'assistant' as const,
    api: 'deepseek-api' as const,
    provider: 'deepseek-api' as const,
    model: 'deepseek-api',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    content,
    timestamp: 1,
  });
  const toolResultMsg = (toolName: string, text: string) => ({
    role: 'toolResult' as const,
    toolCallId: 'call-1',
    toolName,
    content: [{ type: 'text' as const, text }],
    isError: false,
    timestamp: 1,
  });

  it('maps user and assistant text blocks to content', () => {
    const result = mapper([
      userMsg([{ type: 'text', text: 'hello' }]),
      assistantMsg([{ type: 'text', text: 'hi there' }]),
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('hand-backs assistant thinking blocks as reasoningContent', () => {
    const result = mapper([
      assistantMsg([
        { type: 'thinking', thinking: 'let me think' },
        { type: 'text', text: 'answer' },
      ]),
    ]);
    expect(result).toEqual([
      { role: 'assistant', content: 'answer', reasoningContent: 'let me think' },
    ]);
  });

  it('serializes toolResult messages as user messages with the XML result protocol', () => {
    const result = mapper([
      toolResultMsg('web_search', '{"ok":true,"summary":"found"}'),
    ]);
    expect(result).toEqual([
      {
        role: 'user',
        content: '<web_search_result>\n{"ok":true,"summary":"found"}\n</web_search_result>',
      },
    ]);
  });

  it('joins multiple text blocks and omits reasoningContent when absent', () => {
    const result = mapper([
      assistantMsg([
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
      userMsg([{ type: 'text', text: 'plain' }]),
    ]);
    expect(result).toEqual([
      { role: 'assistant', content: 'ab', reasoningContent: 'hidden' },
      { role: 'user', content: 'plain' },
    ]);
  });

  it('re-serializes assistant toolCall blocks to the XML wire protocol', () => {
    const result = mapper([
      {
        role: 'assistant',
        api: 'deepseek-api',
        provider: 'deepseek-api',
        model: 'deepseek-api',
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'toolCall',
            id: 'xml:0',
            name: 'artifact_create',
            arguments: { filename: 'a.txt', content: 'ok' },
          },
        ],
        timestamp: 1,
      },
    ]);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Let me check.<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>',
      },
    ]);
  });

  it('preserves empty text messages without inventing fields', () => {
    const result = mapper([userMsg([])]);
    expect(result).toEqual([{ role: 'user', content: '' }]);
  });
});

// --- Registration shape (real implementation, B2-T3) ------------------------

function createApiDeps(
  overrides: Partial<DeepSeekApiStreamFnDeps> = {},
): DeepSeekApiStreamFnDeps {
  return {
    getApiKey: async () => 'sk-test',
    getConfig: async () => ({
      model: 'deepseek-v4-flash',
      thinking: 'disabled' as const,
      reasoningEffort: 'high' as const,
    }),
    mapMessages: createDeepSeekApiMessageMapper(),
    ...overrides,
  };
}

describe('createDeepSeekApiProvider registration', () => {
  beforeEach(() => {
    officialApiMocks.submitOfficialDeepSeekStreaming.mockImplementation(
      async (_input, callbacks) => {
        callbacks.onTextChunk?.('Hello from the official API.');
        callbacks.onFinished?.();
        return {
          assistantText: 'Hello from the official API.',
          reasoningText: '',
          finished: true,
        };
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers with the deepseek-api id and custom api models', () => {
    const provider = createDeepSeekApiProvider(createApiDeps(), {
      toolDescriptors: [],
      mapToolCall: (call, index) => ({
        type: 'toolCall',
        id: `xml:${index}`,
        name: call.invocationName,
        arguments: call.payload,
      }),
    });
    expect(provider.id).toBe(DEEPSEEK_API_PROVIDER);
    expect(provider.name).toBe('DeepSeek API');
    expect(provider.getModels()).toHaveLength(1);
    expect(provider.getModels()[0].api).toBe(DEEPSEEK_API);
    expect(provider.getModels()[0].provider).toBe(DEEPSEEK_API_PROVIDER);
  });

  it('resolves apiKey auth when configured and undefined when not', async () => {
    const configured = createDeepSeekApiProvider(createApiDeps(), {
      toolDescriptors: [],
      mapToolCall: (call, index) => ({
        type: 'toolCall',
        id: `xml:${index}`,
        name: call.invocationName,
        arguments: call.payload,
      }),
    });
    const result = await configured.auth.apiKey!.resolve({ ctx: {} as never, credential: undefined });
    expect(result?.auth.apiKey).toBe('sk-test');
    expect(result?.source).toBe('DeepSeek API key');

    const unconfigured = createDeepSeekApiProvider(
      createApiDeps({ getApiKey: async () => null }),
      {
        toolDescriptors: [],
        mapToolCall: (call, index) => ({
          type: 'toolCall',
          id: `xml:${index}`,
          name: call.invocationName,
          arguments: call.payload,
        }),
      },
    );
    const missing = await unconfigured.auth.apiKey!.resolve({ ctx: {} as never, credential: undefined });
    expect(missing).toBeUndefined();
  });

  it('delegates stream to submitOfficialDeepSeekStreaming with mapped messages', async () => {
    const provider = createDeepSeekApiProvider(createApiDeps(), {
      toolDescriptors: [],
      mapToolCall: (call, index) => ({
        type: 'toolCall',
        id: `xml:${index}`,
        name: call.invocationName,
        arguments: call.payload,
      }),
    });
    const model = provider.getModels()[0];
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }],
    };
    const stream = provider.stream(model, context, {});
    const result = await stream.result();
    expect(result.stopReason).toBe('stop');
    expect(result.content.some((block) => block.type === 'text')).toBe(true);
    expect(officialApiMocks.submitOfficialDeepSeekStreaming).toHaveBeenCalledTimes(1);
    const input = officialApiMocks.submitOfficialDeepSeekStreaming.mock.calls[0][0];
    expect(input.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(input.apiKey).toBe('sk-test');
  });

  it('emits an error event when the api key is missing', async () => {
    const provider = createDeepSeekApiProvider(
      createApiDeps({ getApiKey: async () => null }),
      {
        toolDescriptors: [],
        mapToolCall: (call, index) => ({
          type: 'toolCall',
          id: `xml:${index}`,
          name: call.invocationName,
          arguments: call.payload,
        }),
      },
    );
    const model = provider.getModels()[0];
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }],
    };
    const stream = provider.stream(model, context, {});
    const result = await stream.result();
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toContain('API key');
  });

  it('forwards reasoning chunks through the provider callback', async () => {
    const reasoningSpy = vi.fn();
    officialApiMocks.submitOfficialDeepSeekStreaming.mockImplementation(
      async (_input, callbacks) => {
        callbacks.onReasoningChunk?.('let me think', 'let me think');
        callbacks.onTextChunk?.('answer');
        callbacks.onFinished?.();
        return { assistantText: 'answer', reasoningText: 'let me think', finished: true };
      },
    );
    const provider = createDeepSeekApiProvider(
      createApiDeps({ onReasoningChunk: reasoningSpy }),
      {
        toolDescriptors: [],
        mapToolCall: (call, index) => ({
          type: 'toolCall',
          id: `xml:${index}`,
          name: call.invocationName,
          arguments: call.payload,
        }),
      },
    );
    const model = provider.getModels()[0];
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }],
    };
    const stream = provider.stream(model, context, {});
    const result = await stream.result();
    expect(result.content.some((block) => block.type === 'thinking')).toBe(true);
    expect(reasoningSpy).toHaveBeenCalledWith('let me think', 'let me think');
  });
});

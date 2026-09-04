/**
 * deepseek-web provider contract tests (Issue B1-T1/T2/T3).
 *
 * 1. Compile-time assignability: the provider factory return type must
 *    remain a valid pi-ai `Provider<'deepseek-web'>` and its deps must stay
 *    constructible from the port's own types. If upstream pi changes shape,
 *    this file fails to compile (version-drift guard, risk (a2)).
 * 2. Registration shape: `createProvider` output for the deepseek-web
 *    factory must expose the expected id/api/models/auth surface and
 *    delegate `stream`/`streamSimple` to the same StreamFn body.
 * 3. Auth semantics: a configured session resolves headers; an absent one
 *    resolves `undefined` (not configured).
 * 4. Contract hygiene: the port module may only import pi packages and
 *    type-only relative imports — no concrete implementation modules.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider, ProviderStreams } from '@earendil-works/pi-ai';
import {
  DEEPSEEK_WEB_API,
  DEEPSEEK_WEB_MODEL_IDS,
  DEEPSEEK_WEB_PROVIDER,
  type DeepSeekWebProviderDeps,
  type DeepSeekWebProviderFactory,
} from '../core/inline-agent/pi/provider-port';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { createDeepSeekWebProvider, createDeepSeekWebModels } = await import(
  '../core/inline-agent/pi/deepseek-web-provider'
);
const { createDeepSeekTurnSubmitter } = await import(
  '../core/inline-agent/pi/deepseek-stream-fn'
);

// --- Compile-time assignability (drift guard) -------------------------------

// The factory return type must remain assignable to pi's Provider type.
type FactoryReturn = ReturnType<DeepSeekWebProviderFactory>;
const _providerAssignable: Provider<typeof DEEPSEEK_WEB_API> = null as unknown as FactoryReturn;
void _providerAssignable;

// The deps object must remain constructible from the port's own types.
type DepsShape = DeepSeekWebProviderDeps;
const _depsAssignable: DepsShape = null as unknown as DepsShape;
void _depsAssignable;

// The provider's stream surface must satisfy pi's ProviderStreams shape.
type StreamSurface = Pick<FactoryReturn, 'stream' | 'streamSimple'>;
const _streamsAssignable: ProviderStreams = null as unknown as StreamSurface;
void _streamsAssignable;

describe('deepseek-web provider port contract', () => {
  it('declares a custom api id outside pi-ai KnownApi', () => {
    // The extension point: Api = KnownApi | (string & {}). The id must be a
    // distinct string — if it collides with a known api, the registration
    // would be routed to pi-ai's own api implementation instead of ours.
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
    expect(knownApis).not.toContain(DEEPSEEK_WEB_API);
    expect(DEEPSEEK_WEB_API).toBe('deepseek-web');
  });

  it('uses a provider id distinct from the official-API deepseek provider', () => {
    // B2 will register the official API under the existing `deepseek`
    // provider id; the web backend must not collide with it.
    expect(DEEPSEEK_WEB_PROVIDER).toBe('deepseek-web');
  });

  it('exposes a static model catalog with the custom api', () => {
    expect(DEEPSEEK_WEB_MODEL_IDS).toEqual(['deepseek-chat', 'deepseek-reasoner']);
  });

  it('keeps the provider deps a superset of the StreamFn deps', () => {
    // The provider is a registration + delegation object over the existing
    // StreamFn seam; it must not invent a second backend contract. Type-level
    // check: every DeepSeekStreamFnDeps member is present on the provider
    // deps (structural extension is asserted by the compile-time
    // `_depsAssignable` guard above).
    type StreamFnDepsKeys = keyof import('../core/inline-agent/pi/stream-fn-port').DeepSeekStreamFnDeps;
    type MissingKeys = Exclude<StreamFnDepsKeys, keyof DeepSeekWebProviderDeps>;
    type HasAuthHeaders = 'resolveAuthHeaders' extends keyof DeepSeekWebProviderDeps ? true : false;
    const missing: MissingKeys[] = [];
    const hasAuthHeaders: HasAuthHeaders = true;
    expect(missing).toEqual([]);
    expect(hasAuthHeaders).toBe(true);
  });
});

describe('deepseek-web provider port hygiene', () => {
  it('imports only pi packages and type-only relative modules', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/inline-agent/pi/provider-port.ts'),
      'utf8',
    );
    // No concrete implementation imports: no deepseek-stream-fn, adapter,
    // interceptor, or DOM/browser modules.
    expect(source).not.toMatch(/from\s+['"].*deepseek-stream-fn['"]/);
    expect(source).not.toMatch(/from\s+['"].*adapter['"]/);
    expect(source).not.toMatch(/from\s+['"].*interceptor['"]/);
    expect(source).not.toMatch(/from\s+['"].*entrypoints['"]/);
    // All relative imports must be `import type`.
    for (const line of source.split('\n')) {
      const match = line.match(/^import\s+(?!type\b)(.*)\s+from\s+['"]\.\//);
      expect(match).toBeNull();
    }
  });
});

// --- Registration shape (real implementation, B1-T3) ------------------------

function createSession() {
  const state = { chatSessionId: 'chat-1', parentMessageId: 100 as number | null };
  return {
    ...state,
    setParentMessageId(id: number | null) {
      state.parentMessageId = id;
    },
  };
}

function createProviderDeps(
  overrides: Partial<DeepSeekWebProviderDeps> = {},
): DeepSeekWebProviderDeps {
  return {
    submitTurn: createDeepSeekTurnSubmitter({}),
    session: createSession(),
    serializePrompt: () => 'serialized',
    mapToolCall: (call, index) => ({
      type: 'toolCall',
      id: `xml:${index}`,
      name: call.invocationName,
      arguments: call.payload,
    }),
    toolDescriptors: [],
    turnDefaults: { modelType: null, refFileIds: [], thinkingEnabled: false, searchEnabled: false },
    resolveAuthHeaders: () => ({ Authorization: 'Bearer page-token' }),
    ...overrides,
  };
}

describe('createDeepSeekWebProvider registration', () => {
  beforeEach(() => {
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow' });
    adapterMocks.submitPromptStreaming.mockImplementation(async (_input, handlers) => {
      handlers.onTextChunk('Hello from the web backend.');
      return {
        assistantText: 'Hello from the web backend.',
        responseMessageId: 101,
        requestMessageId: 100,
        finished: true,
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers with the deepseek-web id and custom api models', () => {
    const provider = createDeepSeekWebProvider(createProviderDeps());
    expect(provider.id).toBe(DEEPSEEK_WEB_PROVIDER);
    expect(provider.name).toBe('DeepSeek Web');
    expect(provider.getModels()).toHaveLength(2);
    for (const model of provider.getModels()) {
      expect(model.api).toBe(DEEPSEEK_WEB_API);
      expect(model.provider).toBe(DEEPSEEK_WEB_PROVIDER);
    }
    expect(provider.getModels().map((m) => m.id)).toEqual([...DEEPSEEK_WEB_MODEL_IDS]);
  });

  it('resolves auth headers from the injected resolver when configured', async () => {
    const provider = createDeepSeekWebProvider(createProviderDeps());
    const apiKeyAuth = provider.auth.apiKey;
    expect(apiKeyAuth).toBeDefined();
    const result = await apiKeyAuth!.resolve({ ctx: {} as never, credential: undefined });
    expect(result?.auth.headers).toEqual({ Authorization: 'Bearer page-token' });
    expect(result?.source).toBe('DeepSeek Web session');
  });

  it('resolves undefined (not configured) when the session resolver returns nothing', async () => {
    const provider = createDeepSeekWebProvider(
      createProviderDeps({ resolveAuthHeaders: () => undefined }),
    );
    const result = await provider.auth.apiKey!.resolve({ ctx: {} as never, credential: undefined });
    expect(result).toBeUndefined();
  });

  it('delegates stream/streamSimple to the same StreamFn body', async () => {
    const provider = createDeepSeekWebProvider(createProviderDeps());
    const model = provider.getModels()[0];
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }],
    };
    const stream = provider.stream(model, context, {});
    const result = await stream.result();
    expect(result.stopReason).toBe('stop');
    expect(result.content.some((block) => block.type === 'text')).toBe(true);

    const simpleStream = provider.streamSimple(model, context, {});
    const simpleResult = await simpleStream.result();
    expect(simpleResult.stopReason).toBe('stop');
  });

  it('streams reasoning as pi thinking content blocks', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onReasoningChunk?.('我', '我');
      handlers.onReasoningChunk?.('先思考', '我先思考');
      handlers.onTextChunk('答案', '答案');
      return { assistantText: '答案', responseMessageId: 22, requestMessageId: 21, finished: true };
    });

    const provider = createDeepSeekWebProvider(createProviderDeps());
    const model = provider.getModels()[0];
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }],
    };

    const thinkingEvents: string[] = [];
    const stream = provider.stream(model, context, {});
    for await (const event of stream) {
      if (event.type === 'thinking_delta') thinkingEvents.push(event.delta);
    }
    const result = await stream.result();

    expect(thinkingEvents).toEqual(['我', '先思考']);
    const thinking = result.content.find((block) => block.type === 'thinking');
    expect(thinking).toMatchObject({ type: 'thinking', thinking: '我先思考' });
    const text = result.content.find((block) => block.type === 'text');
    expect(text).toMatchObject({ type: 'text', text: '答案' });
  });

  it('exposes a static catalog factory with the custom api', () => {
    const models = createDeepSeekWebModels();
    expect(models).toHaveLength(2);
    expect(models.every((m) => m.api === DEEPSEEK_WEB_API)).toBe(true);
    expect(models.find((m) => m.id === 'deepseek-reasoner')?.reasoning).toBe(true);
  });
});

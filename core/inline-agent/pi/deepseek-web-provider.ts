/**
 * deepseek-web pi-ai provider (Issue B1-T3).
 *
 * Registers the DeepSeek web backend as a first-class pi-ai `Provider`
 * through `createProvider`, using the `Api = KnownApi | (string & {})`
 * extension point (`DEEPSEEK_WEB_API`):
 *
 *  - the provider is a **registration + delegation object**: it owns no page
 *    state, no session chain, no authorization. All backend behavior is
 *    delegated to the existing `createDeepSeekStreamFn` /
 *    `createDeepSeekTurnSubmitter` adapters (single authority, AGENTS.md
 *    StreamFn rule) — pi-ai's own api modules are never used, because the
 *    DS-web wire format is not OpenAI-compatible (SSE `{p,o,v}` patches,
 *    XML tool calls, PoW, no native function calling);
 *  - `auth` follows pi-ai's ambient-credential semantics: `resolveAuthHeaders`
 *    is injected by the loop adapter (it reads the page session headers via
 *    the existing `createClientHeaders` path); an absent session resolves to
 *    "not configured" (undefined);
 *  - the static model catalog exposes the released DS-web model ids with the
 *    custom api; `getModels()` is synchronous and never throws;
 *  - `stream`/`streamSimple` both delegate to the same StreamFn body: the pi
 *    agent loop only consumes `stream`; `streamSimple` is the interface
 *    requirement and maps to the identical implementation.
 *
 * Bundle guard: this module imports only `createProvider` (models.js) plus
 * the existing StreamFn adapter — never pi-ai's OpenAI/Anthropic/... api
 * modules (heavy SDKs stay out of the static graph; pi-bundle-budget probe
 * asserts it).
 */
import { createProvider } from '@earendil-works/pi-ai';
import type { Model, ProviderStreams, StreamOptions } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createDeepSeekStreamFn, createDeepSeekTurnSubmitter } from './deepseek-stream-fn';
import {
  DEEPSEEK_WEB_API,
  DEEPSEEK_WEB_MODEL_IDS,
  DEEPSEEK_WEB_PROVIDER,
  type DeepSeekWebProviderDeps,
} from './provider-port';

/** Static model catalog for the deepseek-web provider (B1-T3). */
export function createDeepSeekWebModels(): Model<typeof DEEPSEEK_WEB_API>[] {
  return DEEPSEEK_WEB_MODEL_IDS.map((id) => ({
    id,
    name: id === 'deepseek-chat' ? 'DeepSeek Chat (Web)' : 'DeepSeek Reasoner (Web)',
    api: DEEPSEEK_WEB_API,
    provider: DEEPSEEK_WEB_PROVIDER,
    baseUrl: '',
    reasoning: id === 'deepseek-reasoner',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  }));
}

/**
 * Builds the pi-ai provider for the DeepSeek web backend. The returned
 * `Provider<'deepseek-web'>` streams exactly like the existing custom
 * StreamFn path (same body, same callbacks, same fail-closed semantics).
 */
export function createDeepSeekWebProvider(deps: DeepSeekWebProviderDeps): ReturnType<typeof createProvider<typeof DEEPSEEK_WEB_API>> {
  const { resolveAuthHeaders, ...streamFnDeps } = deps;
  const streamFn = createDeepSeekStreamFn(streamFnDeps);

  return createProvider({
    id: DEEPSEEK_WEB_PROVIDER,
    name: 'DeepSeek Web',
    auth: {
      apiKey: {
        name: 'DeepSeek Web session',
        resolve: async () => {
          const headers = await resolveAuthHeaders();
          if (!headers) return undefined;
          return {
            auth: { headers },
            source: 'DeepSeek Web session',
          };
        },
      },
    },
    models: createDeepSeekWebModels(),
    api: {
      stream: toSyncStream(streamFn),
      streamSimple: toSyncStream(streamFn),
    },
  });
}

/**
 * Adapts a deepseek-web provider to pi's `StreamFn` seam consumed by
 * `runAgentLoop`. The provider's `stream` is typed for `Model<'deepseek-web'>`
 * and `ApiStreamOptions` (which, lacking an `ApiOptionsMap` entry, is the
 * generic `StreamOptions & Record<string, unknown>`), while the loop passes
 * the config model as `Model<Api>` and `SimpleStreamOptions`. The runtime
 * model is always the provider's own catalog entry (api `deepseek-web`) and
 * the StreamFn body consumes only `signal` from options, so this is a
 * type-level widening only — no behavior change.
 */
export function deepSeekWebProviderToStreamFn(
  provider: ReturnType<typeof createProvider<typeof DEEPSEEK_WEB_API>>,
): StreamFn {
  return (model, context, options) =>
    provider.stream(
      model as Model<typeof DEEPSEEK_WEB_API>,
      context,
      options ? { ...options } : undefined,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapts the pi StreamFn (whose type allows a Promise return) to pi-ai's
 * `ProviderStreams` synchronous surface. The deepseek-web StreamFn
 * implementation always returns its event stream synchronously — the Promise
 * arm of the type is never taken. Fail closed: if an upstream change ever
 * returns a Promise, this throws instead of silently misbehaving.
 */
function toSyncStream(streamFn: StreamFn): ProviderStreams['stream'] {
  return (model, context, options?: StreamOptions) => {
    const stream = streamFn(model, context, options);
    if (stream instanceof Promise) {
      throw new Error('deepseek-web StreamFn returned a Promise; provider stream requires a synchronous AssistantMessageEventStream');
    }
    return stream;
  };
}

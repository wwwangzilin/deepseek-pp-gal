/**
 * deepseek-web pi-ai provider port (Issue B1-T1).
 *
 * Contract module: declares the serializable seam between the pi-ai provider
 * registry and the DeepSeek web backend. It MUST NOT import concrete browser,
 * DOM, provider, or entrypoint implementations (AGENTS.md contract rule);
 * only pure types from pi packages and the existing StreamFn port are
 * allowed.
 *
 * The port has three parts:
 *  1. `DEEPSEEK_WEB_API` — the custom `Api` id (`Api = KnownApi | (string &
 *     {})` extension point) that labels every deepseek-web model. It is a
 *     distinct api shape from the OpenAI-compatible ones because the DS-web
 *     wire format is not OpenAI-compatible (SSE `{p,o,v}` patches, XML tool
 *     calls, PoW, no native function calling); the translation layer lives
 *     in the existing StreamFn adapter, never in pi-ai's own api modules.
 *  2. `DeepSeekWebProviderDeps` — the injection surface satisfied by the
 *     loop adapter: the existing `DeepSeekStreamFnDeps` plus an auth-header
 *     resolver. The provider never owns page/session state; it is a pure
 *     registration + delegation object.
 *  3. `DeepSeekWebProviderFactory` — `(deps) => Provider<'deepseek-web'>`,
 *     implemented in B1-T3 via pi-ai's `createProvider`.
 *
 * Version-drift guard: `tests/deepseek-web-provider.test.ts` asserts
 * assignability against the exact pi export shapes (`Provider`,
 * `createProvider`), so an upstream API break fails compilation instead of
 * surfacing at runtime.
 */
import type { Provider } from '@earendil-works/pi-ai';
import type { DeepSeekStreamFnDeps } from './stream-fn-port';

/**
 * Custom pi-ai `Api` id for the DeepSeek web backend. Models with this api
 * are streamed by the deepseek-web provider's own `ProviderStreams`; pi-ai's
 * `ApiOptionsMap` has no entry for it, so stream options fall back to the
 * generic `StreamOptions` shape (compatible: only `signal` is consumed).
 */
export const DEEPSEEK_WEB_API = 'deepseek-web' as const;

/**
 * pi-ai provider id registered for the DeepSeek web backend. Distinct from
 * the official-API provider id (`deepseek`, B2) so the two backends can
 * coexist in one registry.
 */
export const DEEPSEEK_WEB_PROVIDER = 'deepseek-web' as const;

/** Model ids exposed by the deepseek-web provider catalog. */
export const DEEPSEEK_WEB_MODEL_IDS = ['deepseek-chat', 'deepseek-reasoner'] as const;
export type DeepSeekWebModelId = (typeof DEEPSEEK_WEB_MODEL_IDS)[number];

/**
 * Resolves the DS-web session auth headers (Bearer token + x-client-*).
 * Returns undefined when the page session is not configured — the provider
 * reports "not configured" (pi-ai ambient-credential semantics). The loop
 * adapter satisfies this from the existing `createClientHeaders` path; the
 * provider must not read page storage itself.
 */
export type DeepSeekWebAuthHeaderResolver = () =>
  | Record<string, string>
  | undefined
  | Promise<Record<string, string> | undefined>;

/** Dependencies required to build the deepseek-web provider (B1-T3). */
export interface DeepSeekWebProviderDeps extends DeepSeekStreamFnDeps {
  /** DS-web session auth headers for pi-ai auth resolution. */
  resolveAuthHeaders: DeepSeekWebAuthHeaderResolver;
}

/** The pi-ai provider factory implemented by the deepseek-web adapter. */
export type DeepSeekWebProviderFactory = (deps: DeepSeekWebProviderDeps) => Provider<typeof DEEPSEEK_WEB_API>;

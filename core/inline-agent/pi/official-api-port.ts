/**
 * DeepSeek official-API provider port (Issue B2-T1).
 *
 * Contract module: declares the serializable seam between the pi-ai provider
 * registry and the DeepSeek official API backend. It MUST NOT import concrete
 * browser, DOM, provider, or entrypoint implementations (AGENTS.md contract
 * rule); only pure types from pi packages, the official-api contract types,
 * and the existing StreamFn port are allowed.
 *
 * The port has four parts:
 *  1. `DEEPSEEK_API` — the custom `Api` id (`Api = KnownApi | (string & {})`
 *     extension point) for the official-API backend, distinct from
 *     `DEEPSEEK_WEB_API` so both backends coexist in one registry (B2).
 *  2. `DeepSeekApiStreamFnDeps` — the injection surface satisfied by the
 *     loop adapter: an api-key provider, the official chat config provider,
 *     a message mapper (pi `Message[]` → `OfficialDeepSeekMessage[]`), and
 *     per-turn callbacks. The provider never owns credentials or page state.
 *  3. `DeepSeekApiMessageMapper` — the wire-message translation function.
 *     Tool results are serialized as user messages (same XML protocol as the
 *     released chat official-API loop), assistant thinking blocks map to
 *     `reasoningContent` (OpenAI-compatible reasoning hand-back).
 *  4. `DeepSeekApiProviderFactory` — `(deps) => Provider<'deepseek-api'>`,
 *     implemented in B2-T3 via pi-ai's `createProvider`.
 *
 * Version-drift guard: `tests/deepseek-api-provider.test.ts` asserts
 * assignability against the exact pi export shapes, so an upstream API break
 * fails compilation instead of surfacing at runtime.
 */
import type { Provider } from '@earendil-works/pi-ai';
import type { Message } from '@earendil-works/pi-ai';
import type { OfficialApiChatConfig } from '../../chat/official-api-config-contract';
import type { OfficialDeepSeekMessage } from '../../deepseek/official-api';

/** Custom pi-ai `Api` id for the DeepSeek official-API backend (B2). */
export const DEEPSEEK_API = 'deepseek-api' as const;

/** pi-ai provider id registered for the official-API backend. */
export const DEEPSEEK_API_PROVIDER = 'deepseek-api' as const;

/**
 * Maps pi `Message[]` (the loop Context transcript) to the official-API wire
 * messages. Rules (mirroring the released chat official-API loop, which
 * stores the raw streamed text including XML tool calls):
 *  - user/assistant text blocks → `content` (joined text);
 *  - assistant toolCall blocks → re-serialized XML (`<name>{json}</name>`)
 *    appended to `content`: the official API has no native function calling,
 *    so the model must see the full assistant turn it produced (matching the
 *    chat official-API loop, which keeps the raw streamed text);
 *  - assistant thinking blocks → `reasoningContent` (OpenAI-compatible);
 *  - toolResult messages → a `user` message whose content serializes the
 *    tool result (XML `<name_result>` protocol), keeping the model informed
 *    of executed tools in the official-API request chain.
 * Pure function; must not throw.
 */
export type DeepSeekApiMessageMapper = (
  messages: readonly Message[],
) => OfficialDeepSeekMessage[];

/** Dependencies required to build the official-API provider (B2-T3). */
export interface DeepSeekApiStreamFnDeps {
  /** Resolves the stored official-API key; undefined = backend not configured. */
  getApiKey: () => Promise<string | null>;
  /** Resolves the official chat config (model/thinking/reasoningEffort). */
  getConfig: () => Promise<OfficialApiChatConfig>;
  /** Translates the pi Context transcript to official-API wire messages. */
  mapMessages: DeepSeekApiMessageMapper;
  /**
   * Optional forwarder for official-API reasoning chunks (thinking mode).
   * The loop adapter (B2-T5) decides whether/how this surfaces.
   */
  onReasoningChunk?: (text: string, fullText: string) => void;
}

/** The pi-ai provider factory implemented by the official-API adapter. */
export type DeepSeekApiProviderFactory = (deps: DeepSeekApiStreamFnDeps) => Provider<typeof DEEPSEEK_API>;

export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 120_000;
export const MIN_MCP_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_MCP_REQUEST_TIMEOUT_MS = 600_000;

export const MCP_REQUEST_TIMEOUT_STORAGE_KEY = 'deepseek_pp_mcp_request_timeout_ms';

// The globally configured MCP request timeout is the fallback applied by
// normalizeMcpServerConfig (services that do not explicitly set requestMs) and
// by the Shell local preset. Code tasks that need a longer call window can
// therefore be widened once from Settings instead of editing each server's
// advanced timeout configuration. On a fresh install the default keeps the
// previously observed 120s behavior for the Shell preset.
export function clampMcpRequestTimeout(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_MCP_REQUEST_TIMEOUT_MS;
  return Math.min(
    MAX_MCP_REQUEST_TIMEOUT_MS,
    Math.max(MIN_MCP_REQUEST_TIMEOUT_MS, Math.round(numeric)),
  );
}

// Reads the globally configured MCP request timeout. When the setting is
// absent (fresh install) or the storage API is unavailable, it falls back to
// the DEFAULT. This is intentionally the DEFAULT rather than the generic
// MCP_DEFAULT_TIMEOUTS.requestMs (60s): existing installs keep the observed
// 120s behavior instead of silently shrinking.
export async function getMcpRequestTimeoutMs(): Promise<number> {
  if (!globalThis.chrome?.storage?.local) return DEFAULT_MCP_REQUEST_TIMEOUT_MS;
  const data = await globalThis.chrome
    .storage
    .local
    .get(MCP_REQUEST_TIMEOUT_STORAGE_KEY) as Record<string, number | undefined>;
  return clampMcpRequestTimeout(data[MCP_REQUEST_TIMEOUT_STORAGE_KEY]);
}

export async function saveMcpRequestTimeoutMs(value: number): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.set({
    [MCP_REQUEST_TIMEOUT_STORAGE_KEY]: clampMcpRequestTimeout(value),
  });
}

export async function clearMcpRequestTimeoutMs(): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.remove(MCP_REQUEST_TIMEOUT_STORAGE_KEY);
}

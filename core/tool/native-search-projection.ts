import type { ToolDescriptor } from './types';
import { BROWSER_CONTROL_TOOL_PROVIDER_ID } from '../browser-control/types';
import { WEB_SEARCH_TOOL_PROVIDER } from './web-search';

function isExtensionOwnedWebTool(
  descriptor: ToolDescriptor,
  name: 'web_search' | 'web_fetch',
): boolean {
  // Stable identity of the extension-owned local web tools: the local provider
  // contract (kind 'local', id 'web') plus the exact tool name. An MCP tool
  // that merely happens to share the name is not covered.
  return (
    descriptor.name === name &&
    descriptor.provider?.kind === WEB_SEARCH_TOOL_PROVIDER.kind &&
    descriptor.provider?.id === WEB_SEARCH_TOOL_PROVIDER.id
  );
}

/**
 * Stable identity of the extension-owned local web_search descriptor.
 */
export function isExtensionOwnedWebSearchDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return isExtensionOwnedWebTool(descriptor, 'web_search');
}

/**
 * Stable identity of the extension-owned local web_fetch descriptor.
 */
export function isExtensionOwnedWebFetchDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return isExtensionOwnedWebTool(descriptor, 'web_fetch');
}

/**
 * Stable identity of the extension-owned local browser-control descriptors
 * (browser_navigate and friends). Matched by the local provider contract so
 * an MCP tool that merely shares a browser_* name is not covered.
 */
export function isExtensionOwnedBrowserControlDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return (
    descriptor.provider?.kind === 'local' &&
    descriptor.provider?.id === BROWSER_CONTROL_TOOL_PROVIDER_ID
  );
}

/**
 * Model-facing projection: when DeepSeek page-native search is enabled for a
 * turn, remove ALL extension-owned networking tools — web_search, web_fetch,
 * and the browser-control family (browser_navigate and friends) — so the
 * schema and mandatory web guidance disappear together and the model relies
 * on the native search/browsing path instead of competing extension
 * capabilities (observed in #480: the model switched to web_fetch, then to
 * browser_navigate, once earlier tools were removed). MCP, memory, and
 * capability-helper descriptors keep their order, including MCP tools that
 * merely share web_* or browser_* names. When native search is disabled the
 * input array is returned by the same reference, unchanged.
 */
export function projectToolDescriptorsForNativeSearch(
  descriptors: readonly ToolDescriptor[],
  nativeSearchEnabled: boolean,
): readonly ToolDescriptor[] {
  if (!nativeSearchEnabled) return descriptors;
  return descriptors.filter(
    (descriptor) =>
      !isExtensionOwnedWebSearchDescriptor(descriptor) &&
      !isExtensionOwnedWebFetchDescriptor(descriptor) &&
      !isExtensionOwnedBrowserControlDescriptor(descriptor),
  );
}

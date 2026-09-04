import {
  RUNTIME_BOUNDARY_ERROR_CODES,
  RuntimeBoundaryError,
  refreshDeepSeekContentRuntimeContext,
  type RuntimeBrowserTabLike,
  type RuntimeMessageContext,
} from '../../core/messaging/runtime-boundary';

export interface RuntimeBrowserTabReader {
  get(tabId: number): Promise<RuntimeBrowserTabLike>;
}

/**
 * The background owns the only fresh browser-tab lookup in the content RPC
 * path. The message sender proves the document/tab identity; this lookup only
 * refreshes the route that Chrome currently owns for that same tab.
 */
export async function refreshRuntimeMessageContextFromBrowserTab(
  context: RuntimeMessageContext,
  dependencies: {
    tabs: RuntimeBrowserTabReader;
    deepSeekOrigin: string;
  },
): Promise<RuntimeMessageContext> {
  if (context.surface !== 'deepseek_content') return context;
  if (context.tabId === undefined) {
    throw new RuntimeBoundaryError(
      RUNTIME_BOUNDARY_ERROR_CODES.unauthorizedSender,
      'Runtime content sender has no receiving browser tab.',
    );
  }

  let tab: RuntimeBrowserTabLike;
  try {
    tab = await dependencies.tabs.get(context.tabId);
  } catch {
    throw new RuntimeBoundaryError(
      RUNTIME_BOUNDARY_ERROR_CODES.unauthorizedSender,
      'Runtime content sender browser tab is unavailable.',
    );
  }

  return refreshDeepSeekContentRuntimeContext(context, tab, {
    deepSeekOrigin: dependencies.deepSeekOrigin,
  });
}

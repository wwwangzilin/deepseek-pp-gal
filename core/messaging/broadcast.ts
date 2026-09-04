export interface RuntimeBroadcastTab {
  id?: number | null;
}

export interface RuntimeBroadcastDependencies {
  tabUrlPattern: string;
  sendRuntimeMessage(payload: Record<string, unknown>): Promise<unknown>;
  queryTabsByUrl(urlPattern: string): Promise<readonly RuntimeBroadcastTab[]>;
  sendTabMessage(tabId: number, payload: Record<string, unknown>): Promise<unknown>;
  reportError(code: string, error: unknown): void;
}

export async function broadcastRuntimeUpdate(
  payload: Record<string, unknown>,
  excludeTabId: number | undefined,
  dependencies: RuntimeBroadcastDependencies,
): Promise<void> {
  deliverRuntimeMessageBestEffort(
    dependencies.sendRuntimeMessage(payload),
    'broadcast_runtime_delivery_failed',
    dependencies.reportError,
  );

  let tabs: readonly RuntimeBroadcastTab[] = [];
  try {
    tabs = await dependencies.queryTabsByUrl(dependencies.tabUrlPattern);
  } catch (error) {
    dependencies.reportError('broadcast_tabs_query_failed', error);
    if (excludeTabId) {
      deliverRuntimeMessageBestEffort(
        dependencies.sendTabMessage(excludeTabId, payload),
        'broadcast_tab_delivery_failed',
        dependencies.reportError,
      );
    }
    return;
  }

  for (const tab of tabs) {
    // Accept tab id 0 as a valid id (Chrome may assign it in edge cases);
    // truthiness checks silently skip it.
    if (typeof tab.id === 'number' && tab.id !== excludeTabId) {
      deliverRuntimeMessageBestEffort(
        dependencies.sendTabMessage(tab.id, payload),
        'broadcast_tab_delivery_failed',
        dependencies.reportError,
      );
    }
  }
  if (excludeTabId) {
    deliverRuntimeMessageBestEffort(
      dependencies.sendTabMessage(excludeTabId, payload),
      'broadcast_tab_delivery_failed',
      dependencies.reportError,
    );
  }
}

export function deliverRuntimeMessageBestEffort(
  delivery: Promise<unknown>,
  errorCode: string,
  reportError: RuntimeBroadcastDependencies['reportError'],
): void {
  void delivery.catch((error) => {
    if (isExpectedMissingRuntimeMessageReceiverError(error)) return;
    reportError(errorCode, error);
  });
}

export function isExpectedMissingRuntimeMessageReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Receiving end does not exist',
    'The message port closed before a response was received',
    'No tab with id',
  ].some((fragment) => message.includes(fragment));
}

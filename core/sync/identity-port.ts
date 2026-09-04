import {
  hasDeclaredManifestPermission,
  readOptionalChromeApi,
} from '../platform/chrome-api';

export interface SyncWebAuthFlowDetails {
  url: string;
  interactive: boolean;
}

export interface SyncIdentityPort {
  getRedirectUri(): string;
  launchWebAuthFlow(details: SyncWebAuthFlowDetails): Promise<string | undefined>;
}

export function getCurrentSyncIdentityPort(): SyncIdentityPort | null {
  const chromeApi = readOptionalChromeApi(
    () => typeof chrome !== 'undefined' ? chrome : null,
  ) ?? null;
  const runtime = readOptionalChromeApi(() => chromeApi?.runtime) ?? null;
  if (!hasDeclaredManifestPermission(runtime, 'identity')) return null;

  const identity = readOptionalChromeApi(() => chromeApi?.identity) ?? null;
  const getRedirectURL = readOptionalChromeApi(() => identity?.getRedirectURL);
  const launchWebAuthFlow = readOptionalChromeApi(() => identity?.launchWebAuthFlow);
  if (!identity || typeof getRedirectURL !== 'function' || typeof launchWebAuthFlow !== 'function') {
    return null;
  }

  return Object.freeze({
    getRedirectUri: () => identity.getRedirectURL(),
    launchWebAuthFlow: (details: SyncWebAuthFlowDetails) => identity.launchWebAuthFlow(details),
  });
}

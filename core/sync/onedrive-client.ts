import type { OneDriveSyncConfig } from '../types';
import type { StorageBackend } from './storage-backend';
import {
  authedFetch,
  defaultSyncErrorTranslator,
  exchangeCodeForTokens,
  getRedirectUri,
  runAuthCodeFlow,
  type SyncErrorTranslator,
} from './oauth-client';

/**
 * Microsoft OneDrive sync backend using the App Root special folder
 * (drive/special/approot), the OneDrive equivalent of Drive's appDataFolder —
 * an app-private area users don't see in their normal file tree.
 *
 * Sync keys map to item paths under approot, e.g. memories.json →
 * /me/drive/special/approot:/memories.json:/content
 */

const SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access'];
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const API_BASE = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';

/** Minimal credentials needed to run the authorization flow (no timestamp). */
type OneDriveAuthInput = Pick<OneDriveSyncConfig, 'clientId' | 'clientSecret'>;

function buildAuthUrl(config: OneDriveAuthInput, t: SyncErrorTranslator): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getRedirectUri(t),
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES.join(' '),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function cacheKey(config: OneDriveSyncConfig): string {
  return `onedrive:${config.clientId}`;
}

function refreshParams(config: OneDriveSyncConfig): Record<string, string> {
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
}

function requireRefreshToken(config: OneDriveSyncConfig, t: SyncErrorTranslator): string {
  if (!config.refreshToken) {
    throw new Error(t('background.sync.onedriveMissingAuthorization'));
  }
  return config.refreshToken;
}

/**
 * Run first-time authorization and return the durable refresh_token.
 */
export async function authorizeOneDrive(
  config: OneDriveAuthInput,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): Promise<string> {
  const code = await runAuthCodeFlow(buildAuthUrl(config, t), t);
  const tokens = await exchangeCodeForTokens(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: getRedirectUri(t),
    scope: SCOPES.join(' '),
  }, t);
  if (!tokens.refreshToken) {
    throw new Error(t('background.sync.onedriveMissingRefreshToken'));
  }
  return tokens.refreshToken;
}

export function createOneDriveBackend(
  config: OneDriveSyncConfig,
  t: SyncErrorTranslator = defaultSyncErrorTranslator,
): StorageBackend {
  return {
    async test(): Promise<void> {
      requireRefreshToken(config, t);
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config, t),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}?$select=name`,
        { method: 'GET' },
        t,
      );
      if (res.status === 401) throw new Error(t('background.sync.onedriveAuthorizationExpired'));
      if (!res.ok) throw new Error(t('background.sync.onedriveConnectFailed', { status: res.status }));
    },

    async ensureStore(): Promise<void> {
      // App root is created on first reference; touching it via the children
      // endpoint materializes it. No-op here since PUT will create it lazily.
    },

    async get(key: string): Promise<string | null> {
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config, t),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}:/${encodeURIComponent(key)}:/content`,
        { method: 'GET' },
        t,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(t('background.sync.onedriveDownloadFailed', { key, status: res.status }));
      return res.text();
    },

    async put(key: string, content: string): Promise<void> {
      // PUT .../approot:/{key}:/content creates the item if absent, overwrites if present.
      const res = await authedFetch(
        cacheKey(config),
        requireRefreshToken(config, t),
        TOKEN_URL,
        refreshParams(config),
        `${API_BASE}:/${encodeURIComponent(key)}:/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: content,
        },
        t,
      );
      if (!res.ok) throw new Error(t('background.sync.onedriveUploadFailed', { key, status: res.status }));
    },
  };
}

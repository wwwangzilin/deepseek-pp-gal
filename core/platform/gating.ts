import type { McpServerTransportConfig } from '../mcp/types';
import type { PlatformEnvironment } from './capabilities';
import { isCapabilitySupported } from './capabilities';

export function isShellNativeHostSupported(environment: PlatformEnvironment | null | undefined): boolean {
  if (!environment) return false;
  return isCapabilitySupported(environment, 'nativeMessaging');
}

export function getSupportedMcpTransportKinds(
  kinds: readonly McpServerTransportConfig['kind'][],
  environment: PlatformEnvironment | null | undefined,
): McpServerTransportConfig['kind'][] {
  if (isShellNativeHostSupported(environment)) return [...kinds];
  return kinds.filter((kind) => kind !== 'native_messaging');
}

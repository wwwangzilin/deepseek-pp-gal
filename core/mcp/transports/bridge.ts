import type { McpProtocolTransport, McpServerConfig } from '../types';
import { createMcpStreamableHttpTransport } from './http';

export function createMcpBridgeTransport(server: McpServerConfig): McpProtocolTransport {
  // Stdio bridge services expose a stdio MCP process over regular MCP HTTP.
  // Keep command/cwd/env as user-visible bridge metadata; do not wrap JSON-RPC
  // requests in a DeepSeek++-specific envelope that generic bridges cannot parse.
  return createMcpStreamableHttpTransport(server);
}

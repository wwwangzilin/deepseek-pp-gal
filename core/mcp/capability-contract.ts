import type { ToolDescriptor } from '../tool/types';

export const MCP_CAPABILITY_TOOL_PROVIDER_ID = 'mcp_capability';
export const MCP_CAPABILITY_OPERATION_ANNOTATION = 'dpp.mcpCapabilityOperation';

export const MCP_CAPABILITY_OPERATIONS = [
  'discover',
  'describe',
  'invoke',
] as const;

export type McpCapabilityOperation = typeof MCP_CAPABILITY_OPERATIONS[number];

export function getMcpCapabilityOperation(
  descriptor: ToolDescriptor,
): McpCapabilityOperation | null {
  const operation = descriptor.annotations?.[MCP_CAPABILITY_OPERATION_ANNOTATION];
  return (MCP_CAPABILITY_OPERATIONS as readonly string[]).includes(operation ?? '')
    ? operation as McpCapabilityOperation
    : null;
}

export function isMcpCapabilityDescriptor(descriptor: ToolDescriptor): boolean {
  const operation = getMcpCapabilityOperation(descriptor);
  return descriptor.provider.kind === 'local' &&
    descriptor.provider.id === MCP_CAPABILITY_TOOL_PROVIDER_ID &&
    operation !== null &&
    descriptor.id === `local:${MCP_CAPABILITY_TOOL_PROVIDER_ID}:mcp_${operation}`;
}

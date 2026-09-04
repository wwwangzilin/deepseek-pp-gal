import type {
  RuntimeCapabilityInvocationResolver,
} from '../tool/runtime';
import type { ToolCall, ToolResult } from '../tool/types';
import { resolveMcpCapabilityLease, McpCapabilityLeaseError } from './capability-lease';
import {
  isMcpCapabilityInvokeDescriptor,
  parseMcpCapabilityInvocationPayload,
} from './capability-tools';

/**
 * The only generic-proxy route. It accepts an opaque handle issued by
 * discovery, never a raw target name, and returns a canonical real ToolCall
 * for the existing provider registry/MCP execution path.
 */
export function createMcpCapabilityInvocationResolver(): RuntimeCapabilityInvocationResolver {
  return {
    supports: isMcpCapabilityInvokeDescriptor,
    async resolveInvocation(input) {
      const payload = parseMcpCapabilityInvocationPayload(input.call.payload);
      if (!payload) {
        return {
          kind: 'rejected',
          result: capabilityInvocationFailure(
            input.call,
            'mcp_capability_invoke_payload_invalid',
            'mcp_invoke requires a capability and an arguments object; raw tool names are not accepted.',
          ),
        };
      }
      try {
        const descriptor = await resolveMcpCapabilityLease({
          handle: payload.capability,
          owner: input.capabilityScope,
          currentDescriptors: input.currentDescriptors,
          consume: true,
        });
        return {
          kind: 'target',
          descriptor,
          call: {
            ...input.call,
            descriptorId: descriptor.id,
            provider: descriptor.provider,
            name: descriptor.name,
            invocationName: descriptor.invocationName,
            payload: payload.arguments,
            parseError: undefined,
          },
        };
      } catch (error) {
        if (!(error instanceof McpCapabilityLeaseError)) throw error;
        return {
          kind: 'rejected',
          result: capabilityInvocationFailure(input.call, error.code, error.message),
        };
      }
    },
  };
}

function capabilityInvocationFailure(call: ToolCall, code: string, message: string): ToolResult {
  const now = Date.now();
  return {
    ok: false,
    summary: 'MCP capability invoke rejected',
    detail: message,
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider,
    name: call.name,
    error: { code, message, retryable: false },
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    truncated: false,
  };
}

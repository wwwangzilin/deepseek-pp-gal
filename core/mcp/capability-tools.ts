import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n/background';
import type {
  ToolCall,
  ToolDescriptor,
  ToolProviderIdentity,
  ToolResult,
} from '../tool/types';
import type { ToolProviderExecutionContext } from '../tool/provider-registry';
import {
  MCP_CAPABILITY_OPERATION_ANNOTATION,
  MCP_CAPABILITY_OPERATIONS,
  MCP_CAPABILITY_TOOL_PROVIDER_ID,
  getMcpCapabilityOperation,
  isMcpCapabilityDescriptor,
  type McpCapabilityOperation,
} from './capability-contract';
import {
  issueMcpCapabilityLeases,
  McpCapabilityLeaseError,
  resolveMcpCapabilityLease,
} from './capability-lease';
import { isExecutableMcpDescriptor, rankMcpCapabilityDescriptors } from './capability-projection';

export {
  MCP_CAPABILITY_OPERATIONS,
  MCP_CAPABILITY_TOOL_PROVIDER_ID,
  getMcpCapabilityOperation,
};
export type { McpCapabilityOperation };

export const MCP_CAPABILITY_TOOL_PROVIDER: ToolProviderIdentity = Object.freeze({
  kind: 'local',
  id: MCP_CAPABILITY_TOOL_PROVIDER_ID,
  displayName: translate(DEFAULT_LOCALE, 'tool.mcpCapability.providerName'),
  transport: 'in_process',
});

export const MCP_CAPABILITY_TOOL_NAMES = [
  'mcp_discover',
  'mcp_describe',
  'mcp_invoke',
] as const;

type McpCapabilityToolName = typeof MCP_CAPABILITY_TOOL_NAMES[number];

const DISCOVER_LIMIT_DEFAULT = 8;
const DISCOVER_LIMIT_MAX = 20;
const DISCOVER_QUERY_MAX_CHARS = 2_000;
const DISCOVER_CARD_TEXT_MAX_CHARS = 480;

export function createMcpCapabilityToolDescriptors(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolDescriptor[] {
  const provider = createMcpCapabilityToolProviderIdentity(locale);
  return [
    createCapabilityDescriptor(
      provider,
      'mcp_discover',
      'discover',
      translate(locale, 'tool.mcpCapability.discoverTitle'),
      translate(locale, 'tool.mcpCapability.discoverDescription'), {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: DISCOVER_QUERY_MAX_CHARS,
            description: translate(locale, 'tool.mcpCapability.discoverQueryDescription'),
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: DISCOVER_LIMIT_MAX,
            description: translate(locale, 'tool.mcpCapability.discoverLimitDescription'),
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    ),
    createCapabilityDescriptor(
      provider,
      'mcp_describe',
      'describe',
      translate(locale, 'tool.mcpCapability.describeTitle'),
      translate(locale, 'tool.mcpCapability.describeDescription'), {
        type: 'object',
        properties: {
          capability: { type: 'string', description: translate(locale, 'tool.mcpCapability.capabilityDescription') },
          pointer: { type: 'string', description: translate(locale, 'tool.mcpCapability.pointerDescription') },
        },
        required: ['capability'],
        additionalProperties: false,
      },
    ),
    createCapabilityDescriptor(
      provider,
      'mcp_invoke',
      'invoke',
      translate(locale, 'tool.mcpCapability.invokeTitle'),
      translate(locale, 'tool.mcpCapability.invokeDescription'), {
        type: 'object',
        properties: {
          capability: { type: 'string', description: translate(locale, 'tool.mcpCapability.capabilityDescription') },
          arguments: { type: 'object', description: translate(locale, 'tool.mcpCapability.argumentsDescription') },
        },
        required: ['capability', 'arguments'],
        additionalProperties: false,
      },
    ),
  ];
}

export function createMcpCapabilityToolProviderIdentity(
  locale: SupportedLocale = DEFAULT_LOCALE,
): ToolProviderIdentity {
  return {
    ...MCP_CAPABILITY_TOOL_PROVIDER,
    displayName: translate(locale, 'tool.mcpCapability.providerName'),
  };
}

/**
 * MCP servers control their own tool names, so a server may legitimately
 * publish `mcp_discover`. Keep that real tool unchanged and move only our
 * local controls to a deterministic, collision-free invocation name.
 */
export function disambiguateMcpCapabilityToolDescriptors(
  descriptors: readonly ToolDescriptor[],
  occupiedInvocationNames: ReadonlySet<string>,
): ToolDescriptor[] {
  const occupied = new Set(occupiedInvocationNames);
  return descriptors.map((descriptor) => {
    if (!isMcpCapabilityDescriptor(descriptor) || !occupied.has(descriptor.invocationName)) {
      occupied.add(descriptor.invocationName);
      return descriptor;
    }
    const name = allocateCapabilityInvocationName(descriptor.invocationName, occupied);
    occupied.add(name);
    return { ...descriptor, name, invocationName: name };
  });
}

/** Handles catalog controls only. `mcp_invoke` is resolved in the central tool runtime. */
export async function executeMcpCapabilityToolCall(
  call: ToolCall,
  descriptor: ToolDescriptor,
  context: ToolProviderExecutionContext,
): Promise<ToolResult> {
  const operation = getMcpCapabilityOperation(descriptor);
  if (!operation || !isMcpCapabilityDescriptor(descriptor)) {
    return capabilityFailure(call, 'mcp_capability_operation_invalid', 'Unknown MCP capability operation.');
  }
  if (!context.capabilityScope || !context.availableDescriptors) {
    return capabilityFailure(
      call,
      'mcp_capability_scope_missing',
      'MCP capability controls require an authorized runtime capability scope.',
    );
  }
  try {
    if (operation === 'discover') return discoverMcpCapabilities(call, context);
    if (operation === 'describe') return describeMcpCapability(call, context);
    return capabilityFailure(
      call,
      'mcp_capability_invoke_route_required',
      'MCP capability invoke must be resolved by the runtime before provider execution.',
    );
  } catch (error) {
    if (error instanceof McpCapabilityLeaseError) {
      return capabilityFailure(call, error.code, error.message);
    }
    throw error;
  }
}

export function isMcpCapabilityInvokeDescriptor(descriptor: ToolDescriptor): boolean {
  return isMcpCapabilityDescriptor(descriptor) && getMcpCapabilityOperation(descriptor) === 'invoke';
}

export function parseMcpCapabilityInvocationPayload(payload: unknown): {
  capability: string;
  arguments: Record<string, unknown>;
} | null {
  const value = asPlainRecord(payload);
  if (!value || typeof value.capability !== 'string' || !value.capability.trim()) return null;
  const argumentsValue = asPlainRecord(value.arguments);
  if (!argumentsValue) return null;
  return { capability: value.capability.trim(), arguments: argumentsValue };
}

function createCapabilityDescriptor(
  provider: ToolProviderIdentity,
  name: McpCapabilityToolName,
  operation: McpCapabilityOperation,
  title: string,
  description: string,
  inputSchema: ToolDescriptor['inputSchema'],
): ToolDescriptor {
  return {
    id: `local:${MCP_CAPABILITY_TOOL_PROVIDER_ID}:${name}`,
    provider,
    name,
    invocationName: name,
    title,
    description,
    inputSchema,
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
    annotations: {
      [MCP_CAPABILITY_OPERATION_ANNOTATION]: operation,
    },
  };
}

function allocateCapabilityInvocationName(baseName: string, occupied: ReadonlySet<string>): string {
  const qualifiedBase = `dpp_${baseName}`;
  if (!occupied.has(qualifiedBase)) return qualifiedBase;
  let suffix = 2;
  while (occupied.has(`${qualifiedBase}_${suffix}`)) suffix += 1;
  return `${qualifiedBase}_${suffix}`;
}

async function discoverMcpCapabilities(
  call: ToolCall,
  context: ToolProviderExecutionContext,
): Promise<ToolResult> {
  const payload = asPlainRecord(call.payload);
  const query = payload && typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query || query.length > DISCOVER_QUERY_MAX_CHARS) {
    return capabilityFailure(call, 'mcp_capability_discover_query_invalid', 'mcp_discover requires a non-empty query.');
  }
  const limit = decodeDiscoverLimit(payload?.limit);
  if (limit === null) {
    return capabilityFailure(
      call,
      'mcp_capability_discover_limit_invalid',
      `mcp_discover limit must be an integer between 1 and ${DISCOVER_LIMIT_MAX}.`,
    );
  }
  const targets = rankMcpCapabilityDescriptors(
    context.availableDescriptors!.filter(isExecutableMcpDescriptor),
    query,
  );
  const selected = targets.slice(0, limit);
  const issued = await issueMcpCapabilityLeases({
    owner: context.capabilityScope!,
    descriptors: selected,
  });
  return capabilitySuccess(call, {
    query,
    totalCandidates: targets.length,
    candidates: issued.map(({ handle, descriptor, expiresAt }) => ({
      capability: handle,
      ...compactCatalogCardText('name', descriptor.name),
      ...compactCatalogCardText('title', descriptor.title),
      ...compactCatalogCardText('description', descriptor.description),
      ...compactCatalogCardText('provider', descriptor.provider.displayName),
      risk: descriptor.execution.risk,
      expiresAt,
    })),
  });
}

async function describeMcpCapability(
  call: ToolCall,
  context: ToolProviderExecutionContext,
): Promise<ToolResult> {
  const payload = asPlainRecord(call.payload);
  const capability = payload && typeof payload.capability === 'string' ? payload.capability : null;
  if (!capability) {
    return capabilityFailure(call, 'mcp_capability_describe_handle_invalid', 'mcp_describe requires a capability handle.');
  }
  if (payload?.pointer !== undefined && typeof payload.pointer !== 'string') {
    return capabilityFailure(call, 'mcp_capability_describe_pointer_invalid', 'mcp_describe pointer must be a string.');
  }
  const descriptor = await resolveMcpCapabilityLease({
    handle: capability,
    owner: context.capabilityScope!,
    currentDescriptors: context.availableDescriptors!,
    consume: false,
  });
  const pointer = payload?.pointer as string | undefined;
  const schema = pointer === undefined
    ? descriptor.inputSchema
    : resolveJsonPointer(descriptor.inputSchema, pointer);
  if (schema === JSON_POINTER_NOT_FOUND) {
    return capabilityFailure(call, 'mcp_capability_describe_pointer_missing', 'Requested schema pointer does not exist.');
  }
  return capabilitySuccess(call, {
    capability,
    tool: {
      name: descriptor.name,
      title: descriptor.title,
      description: descriptor.description,
      provider: descriptor.provider.displayName,
      risk: descriptor.execution.risk,
    },
    ...(pointer === undefined ? { inputSchema: schema } : { pointer, value: schema }),
  });
}

function decodeDiscoverLimit(value: unknown): number | null {
  if (value === undefined) return DISCOVER_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > DISCOVER_LIMIT_MAX) {
    return null;
  }
  return value;
}

function compactCatalogCardText(
  key: 'name' | 'title' | 'description' | 'provider',
  value: string,
): Record<string, string | boolean> {
  if (value.length <= DISCOVER_CARD_TEXT_MAX_CHARS) return { [key]: value };
  return {
    [key]: `${value.slice(0, DISCOVER_CARD_TEXT_MAX_CHARS)}…`,
    [`${key}Truncated`]: true,
  };
}

const JSON_POINTER_NOT_FOUND = Symbol('json_pointer_not_found');

function resolveJsonPointer(value: unknown, pointer: string): unknown | typeof JSON_POINTER_NOT_FOUND {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return JSON_POINTER_NOT_FOUND;
  let current: unknown = value;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return JSON_POINTER_NOT_FOUND;
      current = current[Number(segment)];
      if (current === undefined) return JSON_POINTER_NOT_FOUND;
      continue;
    }
    const record = asPlainRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return JSON_POINTER_NOT_FOUND;
    current = record[segment];
  }
  return current;
}

function capabilitySuccess(call: ToolCall, output: Record<string, unknown>): ToolResult {
  const now = Date.now();
  return {
    ok: true,
    summary: 'MCP capability catalog result',
    output: output as ToolResult['output'],
    callId: call.id,
    descriptorId: call.descriptorId,
    provider: call.provider,
    name: call.name,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    truncated: false,
  };
}

function capabilityFailure(call: ToolCall, code: string, message: string): ToolResult {
  const now = Date.now();
  return {
    ok: false,
    summary: 'MCP capability request rejected',
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

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

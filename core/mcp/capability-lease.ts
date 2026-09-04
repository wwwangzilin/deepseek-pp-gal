import {
  createToolAuthorizationDescriptorSnapshot,
  isToolAuthorizationDescriptorSnapshotRecord,
  toolDescriptorMatchesAuthorizationSnapshot,
} from '../tool/authorization';
import { createSerialOperationQueue } from '../persistence/serial-operation-queue';
import type {
  ToolAuthorizationDescriptorSnapshot,
  ToolCapabilityScope,
  ToolDescriptor,
} from '../tool/types';

export const MCP_CAPABILITY_LEASE_STORAGE_KEY = 'deepseek_pp_mcp_capability_leases';
export const MCP_CAPABILITY_LEASE_TTL_MS = 15 * 60_000;

const MCP_CAPABILITY_LEASE_STATE_VERSION = 1 as const;
const MAX_ACTIVE_MCP_CAPABILITY_LEASES = 256;
const MAX_MCP_CAPABILITY_LEASE_STATE_BYTES = 2 * 1024 * 1024;
const capabilityLeaseOperations = createSerialOperationQueue();

type LeaseState = 'active' | 'consumed';

interface StoredMcpCapabilityLease {
  id: string;
  owner: ToolCapabilityScope;
  descriptor: ToolAuthorizationDescriptorSnapshot;
  state: LeaseState;
  issuedAt: number;
  expiresAt: number;
  consumedAt?: number;
}

interface McpCapabilityLeaseState {
  version: typeof MCP_CAPABILITY_LEASE_STATE_VERSION;
  leases: Record<string, StoredMcpCapabilityLease>;
}

export class McpCapabilityLeaseError extends Error {
  constructor(
    public readonly code:
      | 'mcp_capability_handle_invalid'
      | 'mcp_capability_handle_expired'
      | 'mcp_capability_handle_owner_mismatch'
      | 'mcp_capability_handle_replayed'
      | 'mcp_capability_descriptor_stale'
      | 'mcp_capability_scope_invalid'
      | 'mcp_capability_lease_limit'
      | 'mcp_capability_lease_state_invalid',
    message: string,
  ) {
    super(message);
    this.name = 'McpCapabilityLeaseError';
  }
}

export interface IssuedMcpCapabilityLease {
  handle: string;
  descriptor: ToolDescriptor;
  expiresAt: number;
}

export async function issueMcpCapabilityLeases(input: {
  owner: ToolCapabilityScope;
  descriptors: readonly ToolDescriptor[];
  now?: number;
}): Promise<IssuedMcpCapabilityLease[]> {
  const now = input.now ?? Date.now();
  const owner = normalizeCapabilityScope(input.owner);
  const descriptors = [...input.descriptors];
  if (new Set(descriptors.map((descriptor) => descriptor.id)).size !== descriptors.length) {
    throw new McpCapabilityLeaseError(
      'mcp_capability_scope_invalid',
      'Capability leases require unique target descriptors.',
    );
  }
  const snapshots = await Promise.all(descriptors.map(createToolAuthorizationDescriptorSnapshot));

  return capabilityLeaseOperations.run(async () => {
    const state = await readState();
    const changed = pruneExpiredLeases(state, now);
    if (Object.keys(state.leases).length + descriptors.length > MAX_ACTIVE_MCP_CAPABILITY_LEASES) {
      if (changed) await writeState(state);
      throw new McpCapabilityLeaseError(
        'mcp_capability_lease_limit',
        'Too many MCP capability leases are active.',
      );
    }
    const expiresAt = now + MCP_CAPABILITY_LEASE_TTL_MS;
    const issued = descriptors.map((descriptor, index) => {
      const handle = `mcp_cap_${crypto.randomUUID()}`;
      state.leases[handle] = {
        id: handle,
        owner: cloneCapabilityScope(owner),
        descriptor: snapshots[index],
        state: 'active',
        issuedAt: now,
        expiresAt,
      };
      return { handle, descriptor, expiresAt };
    });
    await writeState(state);
    return issued;
  });
}

/**
 * Resolves against the live descriptor set before returning the target. An
 * invoke reservation is consumed before provider I/O, so an ambiguous outcome
 * cannot replay the same opaque handle.
 */
export async function resolveMcpCapabilityLease(input: {
  handle: string;
  owner: ToolCapabilityScope;
  currentDescriptors: readonly ToolDescriptor[];
  consume: boolean;
  now?: number;
}): Promise<ToolDescriptor> {
  const handle = normalizeHandle(input.handle);
  const owner = normalizeCapabilityScope(input.owner);
  const now = input.now ?? Date.now();
  return capabilityLeaseOperations.run(async () => {
    const state = await readState();
    const requestedLease = state.leases[handle];
    if (requestedLease?.expiresAt !== undefined && requestedLease.expiresAt <= now) {
      const changed = pruneExpiredLeases(state, now);
      if (changed) await writeState(state);
      throw new McpCapabilityLeaseError(
        'mcp_capability_handle_expired',
        'MCP capability handle has expired.',
      );
    }
    let changed = pruneExpiredLeases(state, now);
    const lease = state.leases[handle];
    if (!lease) {
      if (changed) await writeState(state);
      throw new McpCapabilityLeaseError(
        'mcp_capability_handle_invalid',
        'MCP capability handle is unknown or no longer available.',
      );
    }
    changed = bindAndAssertCapabilityScope(lease.owner, owner) || changed;
    if (input.consume && lease.state !== 'active') {
      if (changed) await writeState(state);
      throw new McpCapabilityLeaseError(
        'mcp_capability_handle_replayed',
        'MCP capability handle has already been used.',
      );
    }
    const descriptor = input.currentDescriptors.find((candidate) => candidate.id === lease.descriptor.id);
    if (
      !descriptor ||
      !isExecutableDescriptor(descriptor) ||
      !await toolDescriptorMatchesAuthorizationSnapshot(descriptor, lease.descriptor)
    ) {
      delete state.leases[handle];
      await writeState(state);
      throw new McpCapabilityLeaseError(
        'mcp_capability_descriptor_stale',
        'MCP target changed or is no longer executable after capability discovery.',
      );
    }
    if (input.consume) {
      lease.state = 'consumed';
      lease.consumedAt = now;
      changed = true;
    }
    if (changed) await writeState(state);
    return descriptor;
  });
}

export function createToolCapabilityScope(input: {
  kind: ToolCapabilityScope['kind'];
  scopeId: string;
  trigger: ToolCapabilityScope['trigger'];
  chatSessionId?: string | null;
  subject?: ToolCapabilityScope['subject'];
}): ToolCapabilityScope {
  return normalizeCapabilityScope({
    kind: input.kind,
    scopeId: input.scopeId,
    trigger: input.trigger,
    chatSessionId: input.chatSessionId ?? null,
    subject: input.subject,
  });
}

function normalizeHandle(value: unknown): string {
  if (typeof value !== 'string' || !/^mcp_cap_[A-Za-z0-9-]{16,}$/.test(value)) {
    throw new McpCapabilityLeaseError(
      'mcp_capability_handle_invalid',
      'MCP capability handle is malformed.',
    );
  }
  return value;
}

function normalizeCapabilityScope(value: ToolCapabilityScope): ToolCapabilityScope {
  if (value.kind !== 'grant' && value.kind !== 'trusted') {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Capability scope kind is invalid.');
  }
  const scopeId = requireIdentity(value.scopeId, 'Capability scope id');
  const chatSessionId = normalizeNullableIdentity(value.chatSessionId, 'Capability chat session id');
  const trigger = value.trigger;
  if (!['manual_chat', 'agent_run', 'automation', 'test', 'sidepanel_chat'].includes(trigger)) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Capability trigger is invalid.');
  }
  if (value.kind === 'grant') {
    if (!value.subject) {
      throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Granted capability scope is missing its receiver subject.');
    }
    const subject = normalizeSubject(value.subject);
    return { kind: 'grant', scopeId, trigger, chatSessionId, subject };
  }
  if (value.subject !== undefined) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Trusted capability scope cannot carry a page subject.');
  }
  return { kind: 'trusted', scopeId, trigger, chatSessionId };
}

/** Returns whether a newly assigned chat id was durably bound. */
function bindAndAssertCapabilityScope(
  expected: ToolCapabilityScope,
  current: ToolCapabilityScope,
): boolean {
  if (
    expected.kind !== current.kind ||
    expected.scopeId !== current.scopeId ||
    !isSameCapabilityWorkflow(expected.trigger, current.trigger)
  ) {
    throw new McpCapabilityLeaseError(
      'mcp_capability_handle_owner_mismatch',
      'MCP capability belongs to another authorized execution scope.',
    );
  }
  if (expected.kind === 'grant') {
    const left = expected.subject;
    const right = current.subject;
    if (!left || !right || !sameReceiverSubject(left, right)) {
      throw new McpCapabilityLeaseError(
        'mcp_capability_handle_owner_mismatch',
        'MCP capability belongs to another extension document.',
      );
    }
  }
  if (expected.chatSessionId === null && current.chatSessionId !== null) {
    expected.chatSessionId = current.chatSessionId;
    if (expected.kind === 'grant' && expected.subject) expected.subject.chatSessionId = current.chatSessionId;
    return true;
  }
  if (expected.chatSessionId !== current.chatSessionId) {
    throw new McpCapabilityLeaseError(
      'mcp_capability_handle_owner_mismatch',
      'MCP capability belongs to another chat session.',
    );
  }
  return false;
}

/** An inline agent is a continuation of its originating manual chat grant. */
function isSameCapabilityWorkflow(
  expected: ToolCapabilityScope['trigger'],
  current: ToolCapabilityScope['trigger'],
): boolean {
  if (expected === current) return true;
  return (expected === 'manual_chat' || expected === 'agent_run') &&
    (current === 'manual_chat' || current === 'agent_run');
}

function cloneCapabilityScope(scope: ToolCapabilityScope): ToolCapabilityScope {
  return scope.kind === 'grant'
    ? {
      ...scope,
      subject: scope.subject ? { ...scope.subject } : undefined,
    }
    : { ...scope };
}

function normalizeSubject(subject: NonNullable<ToolCapabilityScope['subject']>): NonNullable<ToolCapabilityScope['subject']> {
  const documentSessionId = requireIdentity(subject.documentSessionId, 'Capability document session id');
  if (!['deepseek_content', 'extension_context', 'background_workflow'].includes(subject.surface)) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Capability subject surface is invalid.');
  }
  if (subject.tabId !== undefined && (!Number.isInteger(subject.tabId) || subject.tabId < 0)) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Capability subject tab id is invalid.');
  }
  if (subject.frameId !== undefined && (!Number.isInteger(subject.frameId) || subject.frameId < 0)) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', 'Capability subject frame id is invalid.');
  }
  return {
    surface: subject.surface,
    documentSessionId,
    tabId: subject.tabId,
    frameId: subject.frameId,
    chatSessionId: normalizeNullableIdentity(subject.chatSessionId, 'Capability subject chat session id'),
  };
}

function sameReceiverSubject(
  left: NonNullable<ToolCapabilityScope['subject']>,
  right: NonNullable<ToolCapabilityScope['subject']>,
): boolean {
  return left.surface === right.surface &&
    left.documentSessionId === right.documentSessionId &&
    left.tabId === right.tabId &&
    left.frameId === right.frameId;
}

function normalizeNullableIdentity(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentity(value, label);
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpCapabilityLeaseError('mcp_capability_scope_invalid', `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isExecutableDescriptor(descriptor: ToolDescriptor): boolean {
  return descriptor.provider.kind === 'mcp' &&
    descriptor.execution.enabled &&
    descriptor.execution.mode !== 'disabled';
}

async function readState(): Promise<McpCapabilityLeaseState> {
  const stored = await chrome.storage.session.get(MCP_CAPABILITY_LEASE_STORAGE_KEY) as Record<string, unknown>;
  const value = stored[MCP_CAPABILITY_LEASE_STORAGE_KEY];
  if (value === undefined) {
    return { version: MCP_CAPABILITY_LEASE_STATE_VERSION, leases: {} };
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_MCP_CAPABILITY_LEASE_STATE_BYTES ||
    !isStoredLeaseState(value)
  ) {
    throw new McpCapabilityLeaseError(
      'mcp_capability_lease_state_invalid',
      'Stored MCP capability lease state is invalid.',
    );
  }
  return structuredClone(value);
}

async function writeState(state: McpCapabilityLeaseState): Promise<void> {
  await chrome.storage.session.set({ [MCP_CAPABILITY_LEASE_STORAGE_KEY]: state });
}

function pruneExpiredLeases(state: McpCapabilityLeaseState, now: number): boolean {
  let changed = false;
  for (const [handle, lease] of Object.entries(state.leases)) {
    if (lease.expiresAt <= now) {
      delete state.leases[handle];
      changed = true;
    }
  }
  return changed;
}

function isStoredLeaseState(value: unknown): value is McpCapabilityLeaseState {
  if (!isPlainRecord(value) || !isPlainRecord(value.leases)) return false;
  return hasOnlyKeys(value, ['version', 'leases']) &&
    value.version === MCP_CAPABILITY_LEASE_STATE_VERSION &&
    Object.keys(value.leases).length <= MAX_ACTIVE_MCP_CAPABILITY_LEASES &&
    Object.entries(value.leases).every(([handle, lease]) => isStoredLease(handle, lease));
}

function isStoredLease(handle: string, value: unknown): value is StoredMcpCapabilityLease {
  if (!isPlainRecord(value)) return false;
  const lease = value as Partial<StoredMcpCapabilityLease>;
  return hasOnlyKeys(value, [
    'id',
    'owner',
    'descriptor',
    'state',
    'issuedAt',
    'expiresAt',
    'consumedAt',
  ]) &&
    lease.id === handle &&
    /^mcp_cap_[A-Za-z0-9-]{16,}$/.test(handle) &&
    isStoredCapabilityScope(lease.owner) &&
    isToolAuthorizationDescriptorSnapshotRecord(lease.descriptor) &&
    (lease.state === 'active' || lease.state === 'consumed') &&
    isFiniteNumber(lease.issuedAt) &&
    isFiniteNumber(lease.expiresAt) &&
    lease.expiresAt > lease.issuedAt &&
    (
      (lease.state === 'active' && lease.consumedAt === undefined) ||
      (lease.state === 'consumed' && isFiniteNumber(lease.consumedAt) && lease.consumedAt >= lease.issuedAt)
    );
}

function isStoredCapabilityScope(value: unknown): value is ToolCapabilityScope {
  if (!isPlainRecord(value)) return false;
  const scope = value as Partial<ToolCapabilityScope>;
  const common = hasOnlyKeys(value, ['kind', 'scopeId', 'trigger', 'chatSessionId', 'subject']) &&
    (scope.kind === 'grant' || scope.kind === 'trusted') &&
    typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0 &&
    ['manual_chat', 'agent_run', 'automation', 'test', 'sidepanel_chat'].includes(String(scope.trigger)) &&
    (scope.chatSessionId === null || (typeof scope.chatSessionId === 'string' && scope.chatSessionId.trim().length > 0));
  if (!common) return false;
  return scope.kind === 'grant'
    ? isStoredSubject(scope.subject)
    : scope.subject === undefined;
}

function isStoredSubject(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return hasOnlyKeys(value, ['surface', 'documentSessionId', 'tabId', 'frameId', 'chatSessionId']) &&
    ['deepseek_content', 'extension_context', 'background_workflow'].includes(String(value.surface)) &&
    typeof value.documentSessionId === 'string' && value.documentSessionId.trim().length > 0 &&
    (value.tabId === undefined || (Number.isInteger(value.tabId) && (value.tabId as number) >= 0)) &&
    (value.frameId === undefined || (Number.isInteger(value.frameId) && (value.frameId as number) >= 0)) &&
    (value.chatSessionId === null || value.chatSessionId === undefined || (
      typeof value.chatSessionId === 'string' && value.chatSessionId.trim().length > 0
    ));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

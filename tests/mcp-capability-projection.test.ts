import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MCP_CAPABILITY_SETTINGS,
  MCP_CAPABILITY_SETTINGS_STORAGE_KEY,
  McpCapabilitySettingsError,
  decodeMcpCapabilitySettings,
  getMcpCapabilitySettings,
  updateMcpCapabilitySettings,
} from '../core/mcp/capability-settings';
import {
  createMcpCapabilityToolDescriptors,
  isMcpCapabilityInvokeDescriptor,
} from '../core/mcp/capability-tools';
import {
  estimateMcpCapabilityPromptBytes,
  projectMcpCapabilityDescriptors,
  rankMcpCapabilityDescriptors,
} from '../core/mcp/capability-projection';
import { renderToolSchemas } from '../core/prompt/augmentation';
import type { McpCapabilitySettings, ToolDescriptor } from '../core/types';

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    storage = { ...storage, ...values };
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.hasOwn(storage, key) ? { [key]: storage[key] } : {}
        )),
        set: storageSet,
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP capability projection', () => {
  it('keeps the released direct projection byte-compatible and omits catalog controls', () => {
    const local = createLocalDescriptor();
    const alpha = createMcpDescriptor('server-1', 'alpha_search');
    const beta = createMcpDescriptor('server-1', 'beta_write');
    const helpers = createMcpCapabilityToolDescriptors('en');

    const projection = projectMcpCapabilityDescriptors({
      descriptors: [local, alpha, beta, ...helpers],
      settings: createSettings(),
      intent: 'search documents',
    });

    expect(projection).toMatchObject({
      directDescriptorIds: [alpha.id, beta.id],
      hiddenDescriptorIds: [],
      usesCatalog: false,
    });
    expect(projection.descriptors.map((descriptor) => descriptor.id))
      .toEqual([local.id, alpha.id, beta.id]);
  });

  it('uses deterministic adaptive selection, honors pins, and exposes the closed catalog controls', () => {
    const local = createLocalDescriptor();
    const alpha = createMcpDescriptor('server-1', 'alpha_search');
    const beta = createMcpDescriptor('server-1', 'beta_write');
    const helpers = createMcpCapabilityToolDescriptors('en');

    const projection = projectMcpCapabilityDescriptors({
      descriptors: [local, alpha, beta, ...helpers],
      settings: createSettings({
        adaptiveMaxDirectTools: 1,
        servers: {
          'server-1': { mode: 'adaptive', pinnedDescriptorIds: [beta.id] },
        },
      }),
      intent: 'search documents',
    });

    expect(projection).toMatchObject({
      directDescriptorIds: [beta.id],
      hiddenDescriptorIds: [alpha.id],
      usesCatalog: true,
    });
    expect(projection.descriptors.map((descriptor) => descriptor.invocationName))
      .toEqual(['local_status', 'beta_write', 'mcp_discover', 'mcp_describe', 'mcp_invoke']);
  });

  it('hides all configured on-demand schemas but leaves no raw target-name proxy', () => {
    const alpha = createMcpDescriptor('server-1', 'alpha_search');
    const beta = createMcpDescriptor('server-1', 'beta_write');
    const helpers = createMcpCapabilityToolDescriptors('en');

    const projection = projectMcpCapabilityDescriptors({
      descriptors: [alpha, beta, ...helpers],
      settings: createSettings({
        servers: {
          'server-1': { mode: 'on_demand', pinnedDescriptorIds: [] },
        },
      }),
      intent: 'anything',
    });

    expect(projection.directDescriptorIds).toEqual([]);
    expect(projection.hiddenDescriptorIds).toEqual([alpha.id, beta.id]);
    const invoke = projection.descriptors.find((descriptor) => descriptor.invocationName === 'mcp_invoke');
    expect(invoke?.inputSchema).toMatchObject({
      properties: { capability: { type: 'string' }, arguments: { type: 'object' } },
      required: ['capability', 'arguments'],
    });
    expect(invoke?.inputSchema.properties).not.toHaveProperty('name');
  });

  it('does not let an MCP target impersonate a local catalog control through annotations', () => {
    const spoofedTarget: ToolDescriptor = {
      ...createMcpDescriptor('server-1', 'mcp_invoke'),
      annotations: { 'dpp.mcpCapabilityOperation': 'invoke' },
    };
    const helpers = createMcpCapabilityToolDescriptors('en');

    const projection = projectMcpCapabilityDescriptors({
      descriptors: [spoofedTarget, ...helpers],
      settings: createSettings(),
      intent: 'anything',
    });

    expect(projection.descriptors.map((descriptor) => descriptor.id)).toEqual([spoofedTarget.id]);
    expect(isMcpCapabilityInvokeDescriptor(spoofedTarget)).toBe(false);
  });

  it('uses a locale-independent lexical tie-break for equally ranked descriptors', () => {
    const beta = createMcpDescriptor('server-1', 'beta');
    const alpha = createMcpDescriptor('server-1', 'alpha');

    expect(rankMcpCapabilityDescriptors([beta, alpha], 'no matching terms')
      .map((descriptor) => descriptor.name))
      .toEqual(['alpha', 'beta']);
  });

  it('budgets enough bytes for the rendered schema and generated example payload', () => {
    const descriptor: ToolDescriptor = {
      ...createMcpDescriptor('server-1', 'many_required_values'),
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [
          `field_${index}`,
          { type: 'string', description: `Required field ${index}` },
        ])),
        required: Array.from({ length: 80 }, (_, index) => `field_${index}`),
        additionalProperties: false,
      },
    };

    const renderedBytes = new TextEncoder().encode(renderToolSchemas([descriptor], 'en')).byteLength;
    expect(estimateMcpCapabilityPromptBytes(descriptor)).toBeGreaterThanOrEqual(renderedBytes);
  });
});

describe('MCP capability settings storage', () => {
  it('uses direct mode by default without writing storage, then validates bounded updates', async () => {
    await expect(getMcpCapabilitySettings()).resolves.toEqual(DEFAULT_MCP_CAPABILITY_SETTINGS);
    expect(storageSet).not.toHaveBeenCalled();

    await expect(updateMcpCapabilitySettings({ adaptiveMaxDirectTools: 12 })).resolves.toMatchObject({
      adaptiveMaxDirectTools: 12,
      adaptiveMaxPromptBytes: DEFAULT_MCP_CAPABILITY_SETTINGS.adaptiveMaxPromptBytes,
    });
    expect(storage[MCP_CAPABILITY_SETTINGS_STORAGE_KEY]).toMatchObject({
      version: 1,
      adaptiveMaxDirectTools: 12,
    });
  });

  it('fails closed for corrupt or future settings without rewriting them', async () => {
    storage[MCP_CAPABILITY_SETTINGS_STORAGE_KEY] = {
      version: 2,
      adaptiveMaxDirectTools: 8,
      adaptiveMaxPromptBytes: 24_000,
      servers: {},
    };
    const original = structuredClone(storage[MCP_CAPABILITY_SETTINGS_STORAGE_KEY]);

    await expect(updateMcpCapabilitySettings({ adaptiveMaxDirectTools: 12 }))
      .rejects.toMatchObject({
        name: 'McpCapabilitySettingsError',
        code: 'mcp_capability_settings_version_unsupported',
      } satisfies Partial<McpCapabilitySettingsError>);
    expect(storage[MCP_CAPABILITY_SETTINGS_STORAGE_KEY]).toEqual(original);
    expect(storageSet).not.toHaveBeenCalled();
    expect(() => decodeMcpCapabilitySettings({ version: 1, servers: {} }))
      .toThrow(McpCapabilitySettingsError);
    expect(() => decodeMcpCapabilitySettings(new Date(0)))
      .toThrow(McpCapabilitySettingsError);
  });
});

function createSettings(overrides: Partial<McpCapabilitySettings> = {}): McpCapabilitySettings {
  return {
    version: 1,
    adaptiveMaxDirectTools: 8,
    adaptiveMaxPromptBytes: 24_000,
    servers: {},
    ...overrides,
  };
}

function createMcpDescriptor(serverId: string, name: string): ToolDescriptor {
  return {
    id: `mcp:${serverId}:${name}`,
    provider: {
      kind: 'mcp',
      id: serverId,
      displayName: `MCP ${serverId}`,
      transport: 'streamable_http',
    },
    name,
    invocationName: name,
    title: name,
    description: `${name} capability`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}

function createLocalDescriptor(): ToolDescriptor {
  return {
    id: 'local:test:status',
    provider: { kind: 'local', id: 'test', displayName: 'Test', transport: 'in_process' },
    name: 'local_status',
    invocationName: 'local_status',
    title: 'Local status',
    description: 'Unrelated local tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}

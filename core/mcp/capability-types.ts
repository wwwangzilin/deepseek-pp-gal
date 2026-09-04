import type { ToolDescriptor } from '../tool/types';

export const MCP_CAPABILITY_EXPOSURE_MODES = [
  'direct',
  'adaptive',
  'on_demand',
] as const;

export type McpCapabilityExposureMode = typeof MCP_CAPABILITY_EXPOSURE_MODES[number];

export const MCP_CAPABILITY_SETTINGS_VERSION = 1 as const;

export interface McpCapabilityServerSettings {
  mode: McpCapabilityExposureMode;
  pinnedDescriptorIds: string[];
}

/**
 * This is deliberately separate from the MCP server/cache record. Exposure
 * affects only the model-facing projection; server enablement, allowlists and
 * execution policy remain the authoritative execution policy in MCP storage.
 */
export interface McpCapabilitySettings {
  version: typeof MCP_CAPABILITY_SETTINGS_VERSION;
  adaptiveMaxDirectTools: number;
  adaptiveMaxPromptBytes: number;
  servers: Record<string, McpCapabilityServerSettings>;
}

export interface McpCapabilitySettingsPatch {
  adaptiveMaxDirectTools?: number;
  adaptiveMaxPromptBytes?: number;
}

export interface McpCapabilityProjection {
  descriptors: ToolDescriptor[];
  directDescriptorIds: string[];
  hiddenDescriptorIds: string[];
  usesCatalog: boolean;
}

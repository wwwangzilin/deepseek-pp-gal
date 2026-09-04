import { describe, expect, it } from 'vitest';
import {
  canUseMultimodalMediaInput,
  calculateMultimodalRequestAugmentationTimeoutMs,
  createMultimodalMcpPresetInput,
  isMultimodalAnalysisToolAllowed,
  isMultimodalMcpServer,
  MULTIMODAL_MCP_CONNECT_TIMEOUT_MS,
  MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS,
  MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
  type MultimodalMcpServerAvailability,
} from '../core/multimodal/policy';
import { MULTIMODAL_MCP_NATIVE_HOST, MULTIMODAL_MCP_SERVER_NAME } from '../core/multimodal/contracts';

describe('createMultimodalMcpPresetInput', () => {
  it('defaults Multimodal MCP to auto execution', () => {
    const preset = createMultimodalMcpPresetInput();

    expect(preset.displayName).toBe(MULTIMODAL_MCP_SERVER_NAME);
    expect(preset.enabled).toBe(false);
    expect(preset.transport).toEqual({
      kind: 'native_messaging',
      nativeHost: MULTIMODAL_MCP_NATIVE_HOST,
    });
    expect(preset.timeouts).toEqual({
      connectMs: MULTIMODAL_MCP_CONNECT_TIMEOUT_MS,
      requestMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
      discoveryMs: MULTIMODAL_MCP_DISCOVERY_TIMEOUT_MS,
    });
    expect(preset.allowlist).toEqual({ mode: 'allow', toolNames: ['vision_status'] });
    expect(preset.execution).toEqual({ enabled: false, mode: 'auto' });
  });
});

describe('multimodal MCP availability', () => {
  it('identifies the built-in multimodal server by name or native host', () => {
    expect(isMultimodalMcpServer(createServer())).toBe(true);
    expect(isMultimodalMcpServer(createServer({
      displayName: 'Custom Vision',
      transport: { kind: 'native_messaging', nativeHost: MULTIMODAL_MCP_NATIVE_HOST },
    }))).toBe(true);
    expect(isMultimodalMcpServer(createServer({
      displayName: 'Other MCP',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.other' },
    }))).toBe(false);
  });

  it('requires an enabled server, enabled execution, and an allowed analysis tool before showing media input', () => {
    expect(canUseMultimodalMediaInput(createServer())).toBe(true);
    expect(canUseMultimodalMediaInput(createServer({ enabled: false }))).toBe(false);
    expect(canUseMultimodalMediaInput(createServer({
      execution: { enabled: false, mode: 'auto' },
    }))).toBe(false);
    expect(canUseMultimodalMediaInput(createServer({
      execution: { enabled: true, mode: 'disabled' },
    }))).toBe(false);
    expect(canUseMultimodalMediaInput(createServer({
      allowlist: { mode: 'allow', toolNames: ['vision_status'] },
    }))).toBe(false);
  });

  it('treats analyze_images or analyze_video as the actual media-analysis capability', () => {
    expect(isMultimodalAnalysisToolAllowed({ mode: 'allow', toolNames: ['analyze_images'] })).toBe(true);
    expect(isMultimodalAnalysisToolAllowed({ mode: 'allow', toolNames: ['analyze_video'] })).toBe(true);
    expect(isMultimodalAnalysisToolAllowed({ mode: 'allow', toolNames: ['vision_status'] })).toBe(false);
    expect(isMultimodalAnalysisToolAllowed({ mode: 'deny', toolNames: ['vision_status'] })).toBe(true);
    expect(isMultimodalAnalysisToolAllowed({ mode: 'deny', toolNames: ['analyze_images', 'analyze_video'] })).toBe(false);
  });
});

describe('calculateMultimodalRequestAugmentationTimeoutMs', () => {
  it('uses one augmentation budget for image batches or a single video', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'image' },
      { kind: 'image' },
    ])).toBe(MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'video' },
    ])).toBe(MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
  });

  it('accounts for serial video analysis after the image batch', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs([
      { kind: 'image' },
      { kind: 'video' },
      { kind: 'video' },
    ])).toBe(3 * MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS);
  });

  it('caps the bridge wait to the maximum media turn budget', () => {
    expect(calculateMultimodalRequestAugmentationTimeoutMs(
      Array.from({ length: 20 }, () => ({ kind: 'video' as const })),
    )).toBe(MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS);
  });
});

function createServer(
  overrides: Partial<MultimodalMcpServerAvailability> = {},
): MultimodalMcpServerAvailability {
  return {
    displayName: MULTIMODAL_MCP_SERVER_NAME,
    enabled: true,
    transport: {
      kind: 'native_messaging',
      nativeHost: MULTIMODAL_MCP_NATIVE_HOST,
    },
    execution: {
      enabled: true,
      mode: 'auto',
    },
    allowlist: {
      mode: 'allow',
      toolNames: ['analyze_images'],
    },
    ...overrides,
  };
}

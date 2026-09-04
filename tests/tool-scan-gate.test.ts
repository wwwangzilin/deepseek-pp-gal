import { describe, expect, it } from 'vitest';
import { createToolCallScanGate } from '../core/interceptor/tool-scan-gate';
import { createArtifactToolDescriptors } from '../core/artifact/tool';

describe('createToolCallScanGate', () => {
  it('does not scan ordinary streamed text', () => {
    const gate = createToolCallScanGate(createArtifactToolDescriptors('en'));

    expect(gate.shouldScanChunk('Here is a long HTML page: <html>')).toBe(false);
    expect(gate.shouldScanChunk('<body><button>Click</button></body>')).toBe(false);
  });

  it('detects completed tool calls even when the closing tag crosses chunk boundaries', () => {
    const gate = createToolCallScanGate(createArtifactToolDescriptors('en'));

    expect(gate.shouldScanChunk('<artifact_create>{"filename":"simple.html","content":"')).toBe(false);
    expect(gate.shouldScanChunk('<html><body>ok</body></html>"}</artifact_cre')).toBe(false);
    expect(gate.shouldScanChunk('ate>tail text')).toBe(true);
  });

  it('detects close tags after literal malformed close-like text', () => {
    const gate = createToolCallScanGate(createArtifactToolDescriptors('en'));

    expect(gate.shouldScanChunk('math </ text > before </artifact_cre')).toBe(false);
    expect(gate.shouldScanChunk('ate>tail text')).toBe(true);
  });

  it('detects whitespace-padded close tags across chunk boundaries', () => {
    const gate = createToolCallScanGate(createArtifactToolDescriptors('en'));

    expect(gate.shouldScanChunk('<canvas></canvas> </ artifact')).toBe(false);
    expect(gate.shouldScanChunk('_create > tail text')).toBe(true);
  });
});

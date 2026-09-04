/**
 * StreamFn port contract tests (Issue A1-T1).
 *
 * 1. Compile-time assignability: the port factory return must remain a valid
 *    pi `StreamFn` and the parsed XML tool call must remain mappable to a pi
 *    `ToolCall`. If upstream pi changes shape, this file fails to compile
 *    (version-drift guard, risk (a)).
 * 2. Serializability: `DeepSeekTurnRequest` must round-trip through JSON.
 * 3. Contract hygiene: the port module may only import pi packages and
 *    type-only relative imports — no concrete implementation modules.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ToolCall } from '@earendil-works/pi-ai';
import type {
  DeepSeekStreamFnDeps,
  DeepSeekStreamFnFactory,
  DeepSeekTurnRequest,
  ParsedXmlToolCall,
} from '../core/inline-agent/pi/stream-fn-port';

// --- Compile-time assignability (drift guard) -------------------------------

// The factory return type must remain assignable to pi's StreamFn.
type FactoryReturn = ReturnType<DeepSeekStreamFnFactory>;
const _streamFnAssignable: StreamFn = null as unknown as FactoryReturn;
void _streamFnAssignable;

// The deps object must remain constructible from the port's own types.
type DepsShape = DeepSeekStreamFnDeps;
const _depsAssignable: DepsShape = null as unknown as DepsShape;
void _depsAssignable;

// A parsed XML call must remain mappable to pi's ToolCall shape.
const _toolCallMapper = (call: ParsedXmlToolCall, index: number): ToolCall => ({
  type: 'toolCall',
  id: call.name ? `xml:${index}` : `xml:${index}`,
  name: call.invocationName,
  arguments: call.payload,
});
void _toolCallMapper;

describe('stream-fn port contract', () => {
  it('serializes DeepSeekTurnRequest through JSON round-trip', () => {
    const request: DeepSeekTurnRequest = {
      chatSessionId: 'chat-1',
      parentMessageId: 100,
      modelType: null,
      prompt: 'Continue the task.',
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: true,
    };
    const restored = JSON.parse(JSON.stringify(request)) as DeepSeekTurnRequest;
    expect(restored).toEqual(request);
  });

  it('maps a parsed XML tool call to the pi ToolCall shape with a synthesized id', () => {
    const call: ParsedXmlToolCall = {
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: { filename: 'a.txt', content: 'ok' },
    };
    const mapped = _toolCallMapper(call, 0);
    expect(mapped).toEqual({
      type: 'toolCall',
      id: 'xml:0',
      name: 'artifact_create',
      arguments: { filename: 'a.txt', content: 'ok' },
    });
  });

  it('keeps the port module free of implementation imports', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/inline-agent/pi/stream-fn-port.ts'),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .map((line) => line.trim());

    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      if (line.includes('@earendil-works/')) continue;
      // Relative imports must be type-only (contract rule).
      expect(line).toMatch(/^import\s+type\b/);
    }
  });
});

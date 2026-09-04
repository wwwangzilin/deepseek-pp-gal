import { describe, expect, it } from 'vitest';
import { createDiagnosticLogBuffer } from '../core/diagnostics/log-buffer';

describe('diagnostic log buffer', () => {
  it('keeps entries in insertion order and clears on demand', () => {
    const buffer = createDiagnosticLogBuffer(100, 1024 * 1024);
    buffer.record({ level: 'info', source: 'tool-runtime', message: 'tool start: shell_exec' });
    buffer.record({ level: 'warn', source: 'tool-runtime', message: 'authorization denied', details: 'tool_authorization_missing: ...' });

    const snapshot = buffer.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]?.message).toBe('tool start: shell_exec');
    expect(snapshot[1]?.level).toBe('warn');
    expect(snapshot[1]?.ts).toEqual(expect.any(Number));

    buffer.clear();
    expect(buffer.snapshot()).toHaveLength(0);
  });

  it('bounded by entry count, evicting the oldest entries', () => {
    const buffer = createDiagnosticLogBuffer(3, 1024 * 1024);
    buffer.record({ level: 'info', source: 's', message: 'a' });
    buffer.record({ level: 'info', source: 's', message: 'b' });
    buffer.record({ level: 'info', source: 's', message: 'c' });
    buffer.record({ level: 'error', source: 's', message: 'd' });

    expect(buffer.snapshot().map((entry) => entry.message)).toEqual(['b', 'c', 'd']);
  });

  it('bounded by total byte budget', () => {
    const buffer = createDiagnosticLogBuffer(100, 60);
    buffer.record({ level: 'info', source: 's', message: 'x'.repeat(30) });
    buffer.record({ level: 'info', source: 's', message: 'y'.repeat(30) });
    buffer.record({ level: 'info', source: 's', message: 'z'.repeat(30) });

    const snapshot = buffer.snapshot();
    expect(snapshot.length).toBeLessThanOrEqual(2);
  });

  it('never exposes raw payloads through the message field contract', () => {
    const buffer = createDiagnosticLogBuffer();
    buffer.record({ level: 'info', source: 'tool-runtime', message: 'tool start: shell_exec', details: 'ok:true | wrote 123 bytes' });
    for (const entry of buffer.snapshot()) {
      expect(entry).toEqual(expect.objectContaining({
        ts: expect.any(Number),
        level: expect.stringMatching(/^(info|warn|error)$/),
        source: expect.any(String),
        message: expect.any(String),
      }));
      expect(JSON.stringify(entry)).not.toContain('secret');
    }
  });
});

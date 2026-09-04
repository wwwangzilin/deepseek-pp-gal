/**
 * Bounded in-memory diagnostic log buffer.
 *
 * The extension keeps no durable log store by design; this buffer retains the
 * most recent operational events (tool starts, authorization denials, tool
 * results, transport failures) so the user can export a compact diagnostic
 * payload without exposing secrets. Entries are never written to disk and are
 * cleared when the worker restarts.
 */

export type DiagnosticLogLevel = 'info' | 'warn' | 'error';

export interface DiagnosticLogEntry {
  ts: number;
  level: DiagnosticLogLevel;
  source: string;
  message: string;
  /** Short context (never raw payloads or credentials). */
  details?: string;
}

export interface DiagnosticLogBuffer {
  record(entry: Omit<DiagnosticLogEntry, 'ts'>): void;
  snapshot(): readonly DiagnosticLogEntry[];
  clear(): void;
}

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_BYTES = 512 * 1024;

export function createDiagnosticLogBuffer(
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
): DiagnosticLogBuffer {
  let entries: DiagnosticLogEntry[] = [];
  let totalBytes = 0;

  const entrySize = (entry: DiagnosticLogEntry): number =>
    JSON.stringify(entry).length;

  const evict = (): void => {
    while (entries.length > 0 && (
      entries.length > maxEntries || totalBytes > maxBytes
    )) {
      const removed = entries.shift();
      if (removed) totalBytes -= entrySize(removed);
    }
  };

  return {
    record(entry) {
      const stamped: DiagnosticLogEntry = { ...entry, ts: Date.now() };
      entries.push(stamped);
      totalBytes += entrySize(stamped);
      evict();
    },
    snapshot() {
      return [...entries];
    },
    clear() {
      entries = [];
      totalBytes = 0;
    },
  };
}

/** Process-wide buffer used by the background tool runtime. */
export const diagnosticLogBuffer = createDiagnosticLogBuffer();

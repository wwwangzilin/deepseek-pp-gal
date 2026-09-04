import { describe, expect, it, vi } from 'vitest';
import { createContentPersistenceTracker } from '../entrypoints/content/persistence-tracking';

function createHarness() {
  const pending = new Set<Promise<unknown>>();
  const invalidateExtension = vi.fn();
  const reportFailure = vi.fn();
  const tracker = createContentPersistenceTracker({
    isExtensionInvalidated: (error) =>
      error instanceof Error && error.message.includes('Extension context invalidated'),
    invalidateExtension,
    reportFailure,
  });
  return { pending, invalidateExtension, reportFailure, tracker };
}

describe('content persistence tracking', () => {
  it('resolves operations and removes the tracked promise from pending', async () => {
    const { pending, invalidateExtension, reportFailure, tracker } = createHarness();
    await expect(tracker.track(pending, 'tool read', Promise.resolve('ok'))).resolves.toBe('ok');
    expect(pending.size).toBe(0);
    expect(invalidateExtension).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('reports real failures and rethrows while keeping fail-closed semantics', async () => {
    const { pending, invalidateExtension, reportFailure, tracker } = createHarness();
    const failure = new Error('storage quota exceeded');
    await expect(tracker.track(pending, 'tool write', Promise.reject(failure))).rejects.toBe(failure);
    expect(pending.size).toBe(0);
    expect(reportFailure).toHaveBeenCalledWith('tool write', failure);
    expect(invalidateExtension).not.toHaveBeenCalled();
  });

  it('does not report an invalidated extension context as a persistence failure', async () => {
    const { pending, invalidateExtension, reportFailure, tracker } = createHarness();
    const invalidation = new Error('Extension context invalidated.');
    await expect(tracker.track(pending, 'tool read', Promise.reject(invalidation))).rejects.toBe(invalidation);
    expect(pending.size).toBe(0);
    expect(invalidateExtension).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('keeps the promise pending until settlement so stop drains can wait', async () => {
    const { pending, tracker } = createHarness();
    let resolveOperation!: (value: string) => void;
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });
    const tracked = tracker.track(pending, 'agent trace read', operation);
    expect(pending.size).toBe(1);
    resolveOperation('value');
    await expect(tracked).resolves.toBe('value');
    expect(pending.size).toBe(0);
  });
});

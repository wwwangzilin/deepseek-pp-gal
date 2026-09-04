/**
 * Content-script persistence tracking with bounded error reporting.
 *
 * Persistence reads/writes from the isolated world surface their own failure
 * logs through this tracker so the content capability can observe them and
 * drain them on stop. An invalidated extension context (extension reload /
 * uninstall while the page is open) is a lifecycle event handled by the
 * capability dispose path, not a persistence failure, so it is not reported
 * as one.
 */

export interface ContentPersistenceTrackerPort {
  isExtensionInvalidated(error: unknown): boolean;
  invalidateExtension(): void;
  reportFailure(label: string, error: unknown): void;
}

export interface ContentPersistenceTracker {
  /**
   * Tracks `operation` in `pending`, reports real failures through the port,
   * and always removes the tracked promise from `pending` on settlement.
   * The original rejection is rethrown so callers keep their fail-closed
   * semantics; unhandled rejections after invalidation are suppressed by the
   * content invalidation guards.
   */
  track<T>(pending: Set<Promise<unknown>>, label: string, operation: Promise<T>): Promise<T>;
}

export function createContentPersistenceTracker(
  port: ContentPersistenceTrackerPort,
): ContentPersistenceTracker {
  return {
    track<T>(pending: Set<Promise<unknown>>, label: string, operation: Promise<T>): Promise<T> {
      const tracked = operation.catch((error) => {
        if (port.isExtensionInvalidated(error)) {
          port.invalidateExtension();
          throw error;
        }
        port.reportFailure(label, error);
        throw error;
      });
      pending.add(tracked);
      void tracked.then(
        () => pending.delete(tracked),
        () => pending.delete(tracked),
      );
      return tracked;
    },
  };
}

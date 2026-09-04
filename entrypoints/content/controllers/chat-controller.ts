import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceScope,
} from '../lifecycle';

export interface ContentChatController extends ContentCapabilityController {
  handle(message: Record<string, unknown>): Promise<void>;
}

export function createContentChatController(dependencies: {
  readonly dispatch: (message: Record<string, unknown>) => void | Promise<void>;
}): ContentChatController {
  let scope: ContentResourceScope | null = null;
  const pendingDispatches = new Set<Promise<void>>();
  let dispatchTail = Promise.resolve();

  const enqueueDispatch = (message: Record<string, unknown>): Promise<void> => {
    const task = dispatchTail.then(async () => {
      if (!scope?.active) return;
      await dependencies.dispatch(message);
    });

    // A failed inbound event must be reported to its caller without preventing
    // later events from completing their independent lifecycle work.
    dispatchTail = task.catch(() => undefined);
    pendingDispatches.add(task);
    void task.then(
      () => pendingDispatches.delete(task),
      () => pendingDispatches.delete(task),
    );
    return task;
  };

  return {
    id: 'chat-runtime',
    start(nextScope) {
      scope = nextScope;
    },
    async stop(_reason: ContentLifecycleStopReason) {
      scope = null;
      while (pendingDispatches.size > 0) {
        await Promise.allSettled([...pendingDispatches]);
      }
    },
    async handle(message) {
      if (!scope?.active) return;
      await enqueueDispatch(message);
    },
  };
}

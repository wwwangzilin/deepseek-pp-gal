import { describe, expect, it, vi } from 'vitest';
import { createContentChatController } from '../entrypoints/content/controllers/chat-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

describe('Content chat controller', () => {
  it('gates ingress by lifecycle and waits for active dispatch during stop', async () => {
    let releaseDispatch!: () => void;
    const dispatch = vi.fn(() => new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    }));
    const controller = createContentChatController({ dispatch });
    const kernel = createContentLifecycleKernel([controller]);

    await controller.handle({ type: 'BEFORE_START' });
    expect(dispatch).not.toHaveBeenCalled();

    await kernel.start();
    const activeDispatch = controller.handle({ type: 'ACTIVE' });
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = kernel.stop('reinjection').then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseDispatch();
    await activeDispatch;
    await stopping;
    await controller.handle({ type: 'AFTER_STOP' });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('preserves response completion before its terminal cleanup', async () => {
    let releaseCompletion!: () => void;
    const order: string[] = [];
    const dispatch = vi.fn(async (message: Record<string, unknown>) => {
      order.push(`start:${message.type}`);
      if (message.type === 'RESPONSE_COMPLETE') {
        await new Promise<void>((resolve) => {
          releaseCompletion = resolve;
        });
      }
      order.push(`finish:${message.type}`);
    });
    const controller = createContentChatController({ dispatch });
    const kernel = createContentLifecycleKernel([controller]);
    await kernel.start();

    const complete = controller.handle({ type: 'RESPONSE_COMPLETE' });
    const terminal = controller.handle({ type: 'REQUEST_TERMINAL' });
    await Promise.resolve();

    expect(order).toEqual(['start:RESPONSE_COMPLETE']);
    releaseCompletion();
    await Promise.all([complete, terminal]);

    expect(order).toEqual([
      'start:RESPONSE_COMPLETE',
      'finish:RESPONSE_COMPLETE',
      'start:REQUEST_TERMINAL',
      'finish:REQUEST_TERMINAL',
    ]);
    await kernel.stop('manual');
  });
});

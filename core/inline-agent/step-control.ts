/**
 * Shared step-level control helpers for the inline agent.
 *
 * Extracted from the original self-built loop (loop.ts) so the DS-web
 * StreamFn adapter (Issue A1) can reuse the exact same timeout/abort and
 * request-throttling semantics without duplicating them. Behavior is
 * byte-identical to the previous private implementations; the original
 * loop is replaced by the pi engine in Issue A3, which consumes this
 * module as well.
 */
import {
  INLINE_AGENT_REQUEST_DELAY_MAX_MS,
  INLINE_AGENT_REQUEST_DELAY_MIN_MS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
} from './types';

export interface StepSignal {
  signal: AbortSignal;
  clear: () => void;
  timedOut: () => boolean;
}

/**
 * Creates an abort signal that fires either when the parent signal aborts or
 * when the step timeout (120s) elapses. Mirrors the original loop semantics:
 * the timeout reason is a `TimeoutError` DOMException and `timedOut()` reports
 * whether the timeout (not a parent abort) fired.
 */
export function createStepSignal(parentSignal: AbortSignal): StepSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Agent step timed out.', 'TimeoutError'));
  }, INLINE_AGENT_STEP_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (parentSignal.aborted) {
    onParentAbort();
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const clear = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onParentAbort);
  };
  return { signal: controller.signal, clear, timedOut: () => timedOut };
}

/** Resolves after a random 2.5–6.5s delay, or immediately when aborted. */
export function waitBetweenDeepSeekRequests(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const delay = randomInt(INLINE_AGENT_REQUEST_DELAY_MIN_MS, INLINE_AGENT_REQUEST_DELAY_MAX_MS);
  return new Promise((resolve) => {
    const timeout = setTimeout(cleanup, delay);
    const onAbort = () => cleanup();

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

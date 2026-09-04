export interface InlineAgentLiveTargetWaitOptions<
  T,
  TTimer = ReturnType<typeof setTimeout>,
> {
  readonly find: () => T | null;
  readonly observe: (onMutation: () => void) => () => void;
  readonly scheduleTimeout: (callback: () => void, delayMs: number) => TTimer;
  readonly clearScheduledTimeout: (timer: TTimer) => void;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

/**
 * Waits a bounded amount of time for DeepSeek to commit the assistant message
 * that owns a just-completed response.
 *
 * RESPONSE_COMPLETE can arrive before React has mounted the corresponding
 * `.ds-message`. Treat that as a short DOM commit race, not an immediate agent
 * start failure. The caller owns the observer/timer through its content
 * capability scope; abort and timeout both settle fail-closed with `null`.
 */
export function waitForInlineAgentLiveTarget<
  T,
  TTimer = ReturnType<typeof setTimeout>,
>(options: InlineAgentLiveTargetWaitOptions<T, TTimer>): Promise<T | null> {
  const immediate = options.find();
  if (immediate !== null) return Promise.resolve(immediate);
  if (options.signal.aborted || options.timeoutMs <= 0)
    return Promise.resolve(null);

  return new Promise<T | null>((resolve) => {
    let settled = false;
    let stopObserving: (() => void) | null = null;
    let timer: TTimer | null = null;

    const settle = (target: T | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        options.clearScheduledTimeout(timer);
        timer = null;
      }
      options.signal.removeEventListener("abort", handleAbort);
      stopObserving?.();
      stopObserving = null;
      resolve(target);
    };

    const check = () => {
      if (settled || options.signal.aborted) return;
      const target = options.find();
      if (target !== null) settle(target);
    };

    const handleAbort = () => settle(null);
    options.signal.addEventListener("abort", handleAbort, { once: true });
    try {
      stopObserving = options.observe(check);
    } catch {
      // The observing scope can be disposed (pagehide / SPA navigation /
      // reinjection) between the first synchronous lookup and the observer
      // installation. Fail closed like an abort instead of rejecting the
      // promise: the caller then surfaces the regular start-failed path and
      // the abort listener installed above is removed by settle.
      settle(null);
      return;
    }
    timer = options.scheduleTimeout(() => settle(null), options.timeoutMs);

    // Cover a mount that lands between the first synchronous lookup and the
    // observer installation.
    check();
  });
}

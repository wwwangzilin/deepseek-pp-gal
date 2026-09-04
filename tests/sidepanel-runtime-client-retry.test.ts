import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SidepanelRuntimeError,
  createResendingTransport,
  createSidepanelRuntimeClient,
  isRetryableChannelError,
} from '../entrypoints/sidepanel/runtime-client';

describe('sidepanel runtime retry transport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers on a later attempt when the background is still starting', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ version: '1.14.0' });

    const client = createSidepanelRuntimeClient(transport, { retry: { retryDelayMs: 400 } });
    const request = client.request({ type: 'GET_CONFIG' });

    await vi.advanceTimersByTimeAsync(400);
    await expect(request).resolves.toEqual({ version: '1.14.0' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('retries repeatedly and then surfaces a friendly retryable transport error', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue('The message port closed before a response was received.');

    const client = createSidepanelRuntimeClient(transport, {
      retry: { maxAttempts: 3, retryDelayMs: 400 },
    });
    const pending = client.request({ type: 'GET_CONFIG' }).catch((caught) => caught);

    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(400);
    const error = await pending;

    expect(transport).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SidepanelRuntimeError);
    expect(error).toMatchObject({
      kind: 'transport',
      command: 'GET_CONFIG',
      retryable: true,
    });
    expect(error.message).toContain('still starting');
  });

  it('does not retry transport-class but non-recoverable errors like context invalidated', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('Extension context invalidated.'));

    const client = createSidepanelRuntimeClient(transport);
    const error = await client.request({ type: 'GET_CONFIG' }).catch((caught) => caught);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(SidepanelRuntimeError);
    expect(error).toMatchObject({ kind: 'transport', command: 'GET_CONFIG', retryable: false });
    expect(error.message).toBe('Extension context invalidated.');
  });

  it('leaves command-level failures untouched (no retry, same error kind)', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<() => Promise<unknown>>().mockResolvedValue({ ok: false, error: 'denied' });

    const client = createSidepanelRuntimeClient(transport);
    const error = await client.request({ type: 'GET_CONFIG' }).catch((caught) => caught);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ kind: 'command', command: 'GET_CONFIG', message: 'denied' });
  });

  it('createResendingTransport applies the same bounded retry to a raw transport', async () => {
    vi.useFakeTimers();
    const raw = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true });

    const retrying = createResendingTransport(raw, { retryDelayMs: 300 });
    const request = retrying({ type: 'GET_CONFIG' });

    await vi.advanceTimersByTimeAsync(300);
    await expect(request).resolves.toEqual({ ok: true });
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('classifies the exact runtime failure messages that trigger retry', () => {
    expect(isRetryableChannelError(new Error('Could not establish connection. Receiving end does not exist.'))).toBe(true);
    expect(isRetryableChannelError(new Error('The message port closed before a response was received.'))).toBe(true);
    expect(isRetryableChannelError(new Error('Extension context invalidated.'))).toBe(false);
    expect(isRetryableChannelError(new Error('boom'))).toBe(false);
    expect(isRetryableChannelError(new SidepanelRuntimeError({
      kind: 'transport',
      command: 'GET_CONFIG',
      message: 'x',
    }))).toBe(true);
    expect(isRetryableChannelError(new SidepanelRuntimeError({
      kind: 'command',
      command: 'GET_CONFIG',
      message: 'x',
    }))).toBe(false);
  });
});

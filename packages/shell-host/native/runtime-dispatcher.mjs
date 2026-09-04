import { jsonRpcError } from './router.mjs';

export function createNativeEnvelopeDispatcher({
  router,
  channel,
  logger,
  hostEnvironmentReady,
}) {
  const environmentReady = Promise.resolve(hostEnvironmentReady);
  const inFlight = new Set();
  let toolCallTail = Promise.resolve();

  function scheduleEnvelope(envelope) {
    const toolCall = isToolCallEnvelope(envelope);
    const run = () => handleEnvelope(envelope, toolCall);
    const task = toolCall
      ? toolCallTail.then(run, run)
      : run();
    if (toolCall) {
      toolCallTail = task.then(() => undefined, () => undefined);
    }
    inFlight.add(task);
    void task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
  }

  async function handleEnvelope(envelope, waitForHostEnvironment) {
    try {
      if (waitForHostEnvironment) await environmentReady;
      const response = await router.handleEnvelope(envelope);
      if (response) await channel.writeMessage(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.logLine(`Error: ${message}`);
      // Reply with the request's own id when available: the extension matches
      // native responses by id, and an id:null error for a valid request would
      // otherwise hang until the request timeout instead of failing fast.
      const requestId = envelope?.message?.id ?? null;
      await channel.writeMessage(jsonRpcError(requestId, -32603, message || 'Internal error'));
    }
  }

  return Object.freeze({
    scheduleEnvelope,
    async settle() {
      await Promise.allSettled([...inFlight]);
    },
  });
}

function isToolCallEnvelope(envelope) {
  return envelope?.protocol === 'deepseek-pp-mcp-native'
    && envelope?.version === 1
    && envelope?.message?.jsonrpc === '2.0'
    && envelope?.message?.method === 'tools/call';
}

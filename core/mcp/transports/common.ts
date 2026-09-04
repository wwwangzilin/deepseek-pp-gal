import type { McpJsonRpcError, McpJsonRpcRequest, McpJsonRpcResponse, McpServerConfig } from '../types';
import { createAbortScope } from '../../network/abort';

export class McpTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'McpTransportError';
    this.code = code;
    this.retryable = options?.retryable ?? true;
  }
}

export function getMcpEndpointUrl(server: McpServerConfig): URL {
  const url = server.transport.url;
  if (!url) {
    throw new McpTransportError('mcp_endpoint_missing', 'MCP server URL is missing.', { retryable: false });
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
    return parsed;
  } catch {
    throw new McpTransportError('mcp_endpoint_invalid', `Invalid MCP server URL: ${url}`, { retryable: false });
  }
}

export function getMcpOriginPattern(server: McpServerConfig): string {
  const url = getMcpEndpointUrl(server);
  return `${url.protocol}//${url.host}/*`;
}

export async function hasMcpServerOriginPermission(server: McpServerConfig): Promise<boolean> {
  const origin = getMcpOriginPattern(server);
  if (!chrome.permissions?.contains) {
    throw new McpTransportError(
      'mcp_origin_permission_check_unavailable',
      `Host permission cannot be verified for ${origin}.`,
      { retryable: false },
    );
  }
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpTransportError(
      'mcp_origin_permission_check_failed',
      `Host permission could not be verified for ${origin}: ${message}`,
    );
  }
}

export async function ensureMcpServerOriginPermission(server: McpServerConfig): Promise<void> {
  const granted = await hasMcpServerOriginPermission(server);
  if (!granted) {
    throw new McpTransportError(
      'mcp_origin_permission_denied',
      `Host permission was not granted for ${getMcpOriginPattern(server)}.`,
      { retryable: false },
    );
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const callerSignal = init.signal;
  if (callerSignal?.aborted) throwSignalReason(callerSignal);
  const abortScope = createAbortScope(callerSignal, timeoutMs);
  let responseReturned = false;
  try {
    const response = await fetch(input, {
      ...init,
      signal: abortScope.signal,
    });
    abortScope.clearDeadline();
    responseReturned = true;
    if (!callerSignal) {
      abortScope.cleanup();
      return response;
    }
    return wrapResponseBodyWithCleanup(response, abortScope.cleanup);
  } catch (err) {
    if (callerSignal?.aborted) throwSignalReason(callerSignal);
    if (abortScope.timedOut()) {
      throw new McpTransportError('mcp_transport_timeout', `MCP request exceeded ${timeoutMs} ms.`);
    }
    if (err instanceof TypeError) {
      const endpoint = typeof input === 'string' || input instanceof URL ? String(input) : 'configured endpoint';
      throw new McpTransportError(
        'mcp_network_error',
        `Cannot reach MCP server at ${endpoint}. Start the local provider, verify the URL, then retry.`,
      );
    }
    throw err;
  } finally {
    if (!responseReturned) abortScope.cleanup();
  }
}

function wrapResponseBodyWithCleanup(response: Response, cleanup: () => void): Response {
  if (!response.body) {
    cleanup();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      cleanup();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function throwSignalReason(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('MCP request was aborted.', 'AbortError');
}

export async function readJsonRpcResponse<TResult>(
  response: Response,
  expectedRequest?: McpJsonRpcRequest<any>,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<McpJsonRpcResponse<TResult>> {
  if (!response.ok) {
    throw new McpTransportError(
      'mcp_http_error',
      `MCP server returned HTTP ${response.status}.`,
      { retryable: response.status >= 500 },
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return readSseJsonRpcResponse(response, expectedRequest, options);
  }

  const raw = await readResponseTextWithLimit(response, options.maxBytes, options.timeoutMs);
  if (!raw.trim()) {
    throw invalidMcpResponse('MCP response body was empty.');
  }
  try {
    return normalizeJsonRpcResponse(JSON.parse(raw), expectedRequest);
  } catch (error) {
    if (error instanceof McpTransportError) throw error;
    throw invalidMcpResponse('MCP response body was not valid JSON.');
  }
}

export async function readSseJsonRpcResponse<TResult>(
  response: Response,
  expectedRequest?: McpJsonRpcRequest<any>,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<McpJsonRpcResponse<TResult>> {
  if (!response.body) {
    throw new McpTransportError('mcp_sse_empty_body', 'MCP SSE response did not include a body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // The connect fetch cleared its deadline once headers arrived; enforce a
  // fresh one so a server that never emits the matching event cannot hang
  // the request forever (M17).
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let buffer = '';
  let totalBytes = 0;

  while (true) {
    const { done, value } = await readChunkWithDeadline(reader, deadline);
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, options.maxBytes, reader);
    buffer += decoder.decode(value, { stream: true });
    const events = drainSseEvents(buffer);
    buffer = events.remainder;
    for (const event of events.events) {
      const response = parseJsonRpcSseMessage<TResult>(event.data, expectedRequest);
      if (response) return response;
    }
  }

  throw new McpTransportError('mcp_sse_response_missing', 'MCP SSE stream ended without a matching response.');
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes?: number,
  timeoutMs?: number,
): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + (timeoutMs ?? 30_000);
  let totalBytes = 0;
  let raw = '';

  while (true) {
    const { done, value } = await readChunkWithDeadline(reader, deadline);
    if (done) break;
    totalBytes = assertWithinByteLimit(totalBytes, value.byteLength, maxBytes, reader);
    raw += decoder.decode(value, { stream: true });
  }

  raw += decoder.decode();
  return raw;
}

/**
 * Reads one body chunk with a hard phase deadline. A plain
 * `while (Date.now() < deadline)` loop only bounds time *between* chunks: a
 * server that sends headers (or the SSE endpoint event) and then holds the
 * connection open without delivering any body byte makes `reader.read()`
 * never resolve, so the deadline is never re-checked and the request hangs
 * forever. Racing the read against the remaining budget cancels the reader
 * and surfaces a transport timeout instead (M17).
 */
export async function readChunkWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    await reader.cancel().catch(() => undefined);
    throw new McpTransportError(
      'mcp_transport_timeout',
      'MCP response timed out while reading the body.',
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new McpTransportError(
        'mcp_transport_timeout',
        'MCP response timed out while reading the body.',
      ));
    }, remaining);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function assertWithinByteLimit(
  currentBytes: number,
  nextBytes: number,
  maxBytes: number | undefined,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): number {
  const total = currentBytes + nextBytes;
  if (maxBytes && total > maxBytes) {
    reader?.cancel().catch(() => undefined);
    throw new McpTransportError(
      'mcp_response_too_large',
      `MCP response exceeded ${maxBytes} bytes before parsing completed.`,
      { retryable: false },
    );
  }
  return total;
}

export interface SseEvent {
  event: string;
  data: string;
}

export function drainSseEvents(buffer: string): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  const boundaryPattern = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g;
  let blockStart = 0;
  let boundary: RegExpExecArray | null;

  while ((boundary = boundaryPattern.exec(buffer)) !== null) {
    const event = parseSseEvent(buffer.slice(blockStart, boundary.index));
    if (event) events.push(event);
    blockStart = boundary.index + boundary[0].length;
  }

  return { events, remainder: buffer.slice(blockStart) };
}

export function normalizeJsonRpcResponse<TResult>(
  raw: unknown,
  expectedRequest?: McpJsonRpcRequest<any>,
): McpJsonRpcResponse<TResult> {
  if (!isPlainRecord(raw)) {
    throw invalidMcpResponse('MCP response was not a plain JSON object.');
  }
  if (raw.jsonrpc !== '2.0') {
    throw invalidMcpResponse('MCP response jsonrpc must be exactly "2.0".');
  }
  if (!isMcpResponseId(raw.id)) {
    throw invalidMcpResponse('MCP response id must be a string, finite number, or null.');
  }
  if (expectedRequest && raw.id !== expectedRequest.id) {
    throw invalidMcpResponse('MCP response id did not match the active request.');
  }

  const hasResult = Object.prototype.hasOwnProperty.call(raw, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(raw, 'error');
  if (hasResult === hasError) {
    throw invalidMcpResponse('MCP response must contain exactly one of result or error.');
  }
  if (hasResult) {
    return {
      jsonrpc: '2.0',
      id: raw.id,
      result: raw.result as TResult,
    };
  }
  if (!isMcpJsonRpcError(raw.error)) {
    throw invalidMcpResponse('MCP response error must contain an integer numeric code and string message.');
  }
  return {
    jsonrpc: '2.0',
    id: raw.id,
    error: raw.error,
  };
}

export function parseJsonRpcSseMessage<TResult>(
  data: string,
  expectedRequest?: McpJsonRpcRequest<any>,
): McpJsonRpcResponse<TResult> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw invalidMcpResponse('MCP SSE event data was not valid JSON.');
  }

  if (!isPlainRecord(parsed)) {
    throw invalidMcpResponse('MCP SSE message was not a plain JSON object.');
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'method')) {
    assertJsonRpcServerMessage(parsed);
    return null;
  }

  return normalizeJsonRpcResponse<TResult>(parsed, expectedRequest);
}

function invalidMcpResponse(message: string): McpTransportError {
  return new McpTransportError('mcp_response_invalid', message, { retryable: false });
}

function isMcpResponseId(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isMcpJsonRpcError(value: unknown): value is McpJsonRpcError {
  return isPlainRecord(value) &&
    typeof value.code === 'number' &&
    Number.isInteger(value.code) &&
    typeof value.message === 'string';
}

function assertJsonRpcServerMessage(raw: Record<string, unknown>): void {
  if (raw.jsonrpc !== '2.0') {
    throw invalidMcpResponse('MCP server message jsonrpc must be exactly "2.0".');
  }
  if (typeof raw.method !== 'string') {
    throw invalidMcpResponse('MCP server message method must be a string.');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'result') ||
      Object.prototype.hasOwnProperty.call(raw, 'error')) {
    throw invalidMcpResponse('MCP server request or notification cannot contain result or error.');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'id') && !isMcpResponseId(raw.id)) {
    throw invalidMcpResponse('MCP server request id must be a string, finite number, or null.');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'params') && !isStructuredJsonRpcParams(raw.params)) {
    throw invalidMcpResponse('MCP server message params must be an object or array.');
  }
}

function isStructuredJsonRpcParams(value: unknown): boolean {
  return Array.isArray(value) || isPlainRecord(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseSseEvent(block: string): SseEvent | null {
  const lines = block.split(/\r\n|\r|\n/);
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

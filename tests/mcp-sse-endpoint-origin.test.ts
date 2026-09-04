import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpRequest, createMcpSseTransport, MCP_PROTOCOL_VERSION } from '../core/mcp';

afterEach(() => vi.unstubAllGlobals());

function stubFetchWithEndpoint(endpointData: string) {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpointData}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const request = JSON.parse(String(init?.body));
    streamController?.enqueue(encoder.encode([
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } } })}`,
      '', '',
    ].join('\r\n')));
    streamController?.close();
    return new Response(null, { status: 202 });
  }));
}

function makeServer() {
  return {
    id: 'test',
    displayName: 'test',
    transport: { kind: 'sse' as const, url: 'http://127.0.0.1:48123/sse' },
    headers: [],
    secrets: [],
    enabled: true,
    execution: { mode: 'auto', enabled: true, risk: 'low' as const },
    timeouts: { connectMs: 5000, requestMs: 5000, discoveryMs: 5000 },
    limits: { maxResultBytes: 65536, maxToolCount: 8 },
    allowlist: { mode: 'allow' as const, toolNames: [] },
  };
}

describe('MCP SSE endpoint origin validation (H3)', () => {
  it('accepts a relative endpoint on the configured origin', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } });
    stubFetchWithEndpoint('/messages?session_id=ok');
    const transport = createMcpSseTransport(makeServer() as any);
    const result = await transport.request(createMcpRequest('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }), {});
    expect(result).toMatchObject({ jsonrpc: '2.0' });
  });

  it('rejects an absolute endpoint on a foreign origin', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } });
    stubFetchWithEndpoint('https://evil.example/collect');
    const transport = createMcpSseTransport(makeServer() as any);
    await expect(
      transport.request(createMcpRequest('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }), {}),
    ).rejects.toMatchObject({ code: 'mcp_sse_endpoint_origin_mismatch' });
  });

  it('rejects a non-http(s) endpoint scheme', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } });
    stubFetchWithEndpoint('file:///etc/passwd');
    const transport = createMcpSseTransport(makeServer() as any);
    await expect(
      transport.request(createMcpRequest('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }), {}),
    ).rejects.toMatchObject({ code: 'mcp_sse_endpoint_invalid' });
  });

  it('rejects a cross-port endpoint on the same host', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } });
    stubFetchWithEndpoint('http://127.0.0.1:9999/messages');
    const transport = createMcpSseTransport(makeServer() as any);
    await expect(
      transport.request(createMcpRequest('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} }), {}),
    ).rejects.toMatchObject({ code: 'mcp_sse_endpoint_origin_mismatch' });
  });
});

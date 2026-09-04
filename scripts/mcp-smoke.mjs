import http from 'node:http';
import assert from 'node:assert/strict';

const MCP_PROTOCOL_VERSION = '2025-06-18';

const serverConfig = {
  id: 'mock',
  displayName: 'Mock MCP',
  enabled: true,
  transport: {
    kind: 'streamable_http',
    url: '',
  },
  timeouts: {
    connectMs: 1000,
    requestMs: 1000,
    discoveryMs: 1000,
  },
  limits: {
    maxResultBytes: 64000,
    maxToolCount: 128,
  },
  allowlist: {
    mode: 'deny',
    toolNames: ['blocked'],
  },
  execution: {
    mode: 'auto',
    enabled: true,
  },
};

const mockTools = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Return the text argument.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'blocked',
    title: 'Blocked',
    description: 'A disabled mock tool.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const { server, url } = await startMockMcpServer();
serverConfig.transport.url = url;

try {
  const initialize = await requestJsonRpc(serverConfig, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: { name: 'DeepSeek++ smoke', version: '0.0.0' },
  });
  assert.equal(initialize.protocolVersion, MCP_PROTOCOL_VERSION);

  const listed = await requestJsonRpc(serverConfig, 'tools/list');
  const descriptors = applyMcpToolPolicy(
    listed.tools.map((tool) => normalizeMcpToolDescriptor(serverConfig, tool)),
    serverConfig,
  );
  assert.equal(descriptors.length, 2);

  const injectable = descriptors.filter((tool) => tool.execution.enabled && tool.execution.mode === 'auto');
  assert.deepEqual(injectable.map((tool) => tool.name), ['echo']);

  const rendered = renderToolSchemas(injectable);
  assert.match(rendered, /Accepted tag names: mcp_mock_echo, echo/);
  assert.match(rendered, /<echo>/);
  assert.match(rendered, /Invalid formats: <invoke name="echo">/);
  assert.doesNotMatch(rendered, /mcp_mock_blocked/);
  assert.doesNotMatch(rendered, /"type":"function"/);

  const responseText = 'Before <mcp_mock_echo>{"text":"hello"}</mcp_mock_echo> After';
  const calls = extractToolCalls(responseText, injectable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'echo');
  assert.deepEqual(calls[0].payload, { text: 'hello' });
  assert.equal(stripToolCalls(responseText, injectable).trim(), 'Before  After');

  const shortResponseText = 'Before <echo>{"text":"short"}</echo> After';
  const shortCalls = extractToolCalls(shortResponseText, injectable);
  assert.equal(shortCalls.length, 1);
  assert.equal(shortCalls[0].name, 'echo');
  assert.deepEqual(shortCalls[0].payload, { text: 'short' });
  assert.equal(stripToolCalls(shortResponseText, injectable).trim(), 'Before  After');

  const emptyBodyCalls = extractToolCalls('<echo></echo>', injectable);
  assert.equal(emptyBodyCalls.length, 1);
  assert.deepEqual(emptyBodyCalls[0].payload, {});
  assert.equal(emptyBodyCalls[0].parseError, undefined);

  const badPathText = String.raw`<echo>{"path":"D:\ai project\deepseek-pp-main"}</echo>`;
  const badPathCalls = extractToolCalls(badPathText, injectable);
  assert.equal(badPathCalls.length, 1);
  assert.equal(badPathCalls[0].parseError.code, 'tool_call_json_invalid');

  const genericWrapperText = '<tool_call>{"name":"mcp_mock_echo","arguments":{"text":"hello"}}</tool_call>';
  assert.equal(extractToolCalls(genericWrapperText, injectable).length, 0);
  const invokeWrapperText = '<invoke name="mcp_mock_echo">{"text":"hello"}</invoke>';
  assert.equal(extractToolCalls(invokeWrapperText, injectable).length, 0);

  const genericTools = [
    createLocalToolDescriptor('memory_save', 'DeepSeek++ Memory'),
    ...injectable,
    createLocalToolDescriptor('custom_lookup', 'Custom Tool Provider'),
  ];
  const multiToolText = [
    '<memory_save>{"type":"topic","name":"n","content":"c","tags":[]}</memory_save>',
    '<mcp_mock_echo>{"text":"hello"}</mcp_mock_echo>',
    '<custom_lookup>{"query":"hello"}</custom_lookup>',
  ].join('\n');
  const genericCalls = extractToolCalls(multiToolText, genericTools);
  assert.deepEqual(genericCalls.map((call) => call.provider.displayName), [
    'DeepSeek++ Memory',
    'Mock MCP',
    'Custom Tool Provider',
  ]);
  assert.equal(stripToolCalls(multiToolText, genericTools).trim(), '');
  assert.match(renderToolBlockSnapshot(genericCalls.map((call) => ({
    name: call.name,
    provider: call.provider,
    result: {
      ok: true,
      summary: 'executed',
      output: { tool: call.name },
    },
  }))), /Custom Tool Provider \/ custom_lookup/);

  const callResult = await callMcpTool(serverConfig, calls[0]);
  assert.equal(callResult.ok, true);
  assert.equal(callResult.output.echoed, 'hello');
  assert.match(callResult.detail, /hello/);

  await assert.rejects(
    requestJsonRpc(serverConfig, 'slow', {}, { timeoutMs: 10 }),
    (error) => error.code === 'mcp_transport_timeout',
  );

  console.log('mcp smoke: discovery ok');
  console.log('mcp smoke: descriptor render/parser/filter ok');
  console.log('mcp smoke: tool call and timeout paths ok');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function startMockMcpServer() {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }

    const body = await readBody(request);
    const message = JSON.parse(body);
    if (message.method === 'slow') {
      await delay(100);
    }

    const result = routeJsonRpc(message);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result,
    }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object');
      resolve({ server, url: `http://127.0.0.1:${address.port}/mcp` });
    });
  });
}

function routeJsonRpc(message) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    };
  }
  if (message.method === 'tools/list') {
    return { tools: mockTools };
  }
  if (message.method === 'tools/call') {
    const args = message.params?.arguments ?? {};
    return {
      content: [{ type: 'text', text: `echo:${args.text ?? ''}` }],
      structuredContent: { echoed: args.text ?? '' },
      isError: false,
    };
  }
  return {};
}

async function requestJsonRpc(config, method, params, options = {}) {
  const response = await fetchWithTimeout(config.transport.url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      ...(params ? { params } : {}),
    }),
  }, options.timeoutMs ?? config.timeouts.requestMs);

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = 'mcp_http_error';
    throw error;
  }

  const data = await response.json();
  if (data.error) {
    const error = new Error(data.error.message);
    error.code = 'mcp_json_rpc_error';
    throw error;
  }
  return data.result;
}

async function callMcpTool(config, call) {
  const result = await requestJsonRpc(config, 'tools/call', {
    name: call.name,
    arguments: call.payload,
  });
  const output = result.structuredContent ?? result.content ?? null;
  return {
    ok: result.isError !== true,
    summary: result.isError ? 'MCP tool returned an error' : 'MCP tool executed',
    detail: JSON.stringify(output, null, 2),
    output,
  };
}

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const transportError = new Error(`MCP request exceeded ${timeoutMs} ms.`);
      transportError.code = 'mcp_transport_timeout';
      throw transportError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMcpToolDescriptor(config, tool) {
  const invocationName = createMcpInvocationName(config.id, tool.name);
  return {
    id: `mcp:${config.id}:${tool.name}`,
    provider: {
      kind: 'mcp',
      id: config.id,
      displayName: config.displayName,
      transport: config.transport.kind,
    },
    name: tool.name,
    invocationName,
    title: tool.title || tool.name,
    description: tool.description || `MCP tool ${tool.name}`,
    inputSchema: {
      ...tool.inputSchema,
      type: 'object',
      properties: tool.inputSchema?.properties ?? {},
    },
    execution: {
      mode: config.execution.mode,
      enabled: config.enabled && config.execution.enabled,
      risk: 'medium',
      timeoutMs: config.timeouts.requestMs,
      maxResultBytes: config.limits.maxResultBytes,
    },
  };
}

function createLocalToolDescriptor(name, displayName) {
  return {
    id: `local:${name}`,
    provider: {
      kind: 'local',
      id: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      displayName,
      transport: 'in_process',
    },
    name,
    invocationName: name,
    title: name,
    description: `${name} test tool`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    execution: {
      mode: 'auto',
      enabled: true,
      risk: 'low',
    },
  };
}

function applyMcpToolPolicy(tools, config) {
  const names = new Set(config.allowlist.toolNames);
  return tools.map((tool) => {
    const selected = names.has(tool.name) || names.has(tool.invocationName);
    const allowed = config.allowlist.mode === 'all'
      ? true
      : config.allowlist.mode === 'allow'
        ? selected
        : !selected;
    return {
      ...tool,
      execution: {
        ...tool.execution,
        mode: config.execution.mode,
        enabled: config.enabled && config.execution.enabled && config.execution.mode !== 'disabled' && allowed,
      },
    };
  });
}

function renderToolSchemas(descriptors) {
  const catalog = createToolInvocationCatalog(descriptors);
  return descriptors.map((descriptor) => {
    const names = catalog.namesById.get(descriptor.id) ?? [descriptor.invocationName];
    const trimmedName = descriptor.name.trim();
    const preferred = (trimmedName && names.includes(trimmedName)) ? trimmedName : (names[0] ?? descriptor.invocationName);
    return [
      `### Tool ${preferred}`,
      `Title: ${descriptor.title}`,
      `Description: ${descriptor.description}`,
      names.length > 1 ? `Accepted tag names: ${names.join(', ')}` : '',
      `Valid call format for ${preferred}:`,
      `<${preferred}>`,
      JSON.stringify(createExamplePayload(descriptor), null, 2),
      `</${preferred}>`,
      `Invalid formats: <invoke name="${preferred}">...</invoke>, <tool_call>...</tool_call>`,
      `Parameters JSON Schema: ${JSON.stringify(descriptor.inputSchema)}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function createExamplePayload(descriptor) {
  const properties = descriptor.inputSchema.properties ?? {};
  const required = descriptor.inputSchema.required ?? Object.keys(properties);
  return Object.fromEntries(required.map((key) => [key, exampleValue(properties[key])]));
}

function exampleValue(schema) {
  if (!schema || typeof schema !== 'object') return 'value';
  if (Array.isArray(schema.type)) return exampleValue({ ...schema, type: schema.type[0] });
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default:
      return 'value';
  }
}

function extractToolCalls(text, descriptors) {
  const catalog = createToolInvocationCatalog(descriptors);
  if (catalog.byName.size === 0) return [];
  const names = [...catalog.byName.keys()].map(escapeRegExp).join('|');
  const regex = new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, 'g');
  const calls = [];
  let match;
  while ((match = regex.exec(text))) {
    const descriptor = catalog.byName.get(match[1]);
    const body = match[2].trim();
    let payload = {};
    let parseError;
    try {
      payload = body.length === 0 ? {} : JSON.parse(body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        parseError = { code: 'tool_call_payload_invalid', message: 'Tool call body must be a JSON object.', retryable: false };
        payload = {};
      }
    } catch (error) {
      parseError = { code: 'tool_call_json_invalid', message: error instanceof Error ? error.message : String(error), retryable: false };
    }
    calls.push({
      descriptorId: descriptor.id,
      provider: descriptor.provider,
      name: descriptor.name,
      invocationName: descriptor.invocationName,
      payload,
      raw: match[0],
      parseError,
    });
  }
  return calls;
}

function stripToolCalls(text, descriptors) {
  const names = createToolInvocationCatalog(descriptors).names.map(escapeRegExp).join('|');
  return text.replace(new RegExp(`<(${names})>\\s*[\\s\\S]*?\\s*<\\/\\1>`, 'g'), '');
}

function renderToolBlockSnapshot(executions) {
  return [
    `Executed tools (${executions.length})`,
    ...executions.map((execution) => {
      const name = execution.provider?.displayName
        ? `${execution.provider.displayName} / ${execution.name}`
        : execution.name;
      const output = execution.result.output === undefined
        ? ''
        : JSON.stringify(execution.result.output, null, 2);
      return `${name}\n${execution.result.summary}\n${output}`;
    }),
  ].join('\n---\n');
}

function createMcpInvocationName(serverId, toolName) {
  return `mcp_${sanitizeName(serverId)}_${sanitizeName(toolName)}`.slice(0, 96);
}

function createToolInvocationCatalog(descriptors) {
  const byName = new Map();
  const namesById = new Map();
  const toolNameCounts = new Map();
  for (const descriptor of descriptors) {
    const name = descriptor.name.trim();
    if (!isValidToolTagName(name)) continue;
    toolNameCounts.set(name, (toolNameCounts.get(name) ?? 0) + 1);
  }
  for (const descriptor of descriptors) {
    const invocationName = descriptor.invocationName.trim();
    const name = descriptor.name.trim();
    const accepted = [];
    addAcceptedName(byName, accepted, invocationName, descriptor);
    if (
      name !== invocationName &&
      isValidToolTagName(name) &&
      toolNameCounts.get(name) === 1
    ) {
      addAcceptedName(byName, accepted, name, descriptor);
    }
    namesById.set(descriptor.id, accepted);
  }
  return { byName, names: [...byName.keys()], namesById };
}

function addAcceptedName(byName, accepted, name, descriptor) {
  if (!isValidToolTagName(name) || byName.has(name)) return;
  byName.set(name, descriptor);
  accepted.push(name);
}

function isValidToolTagName(value) {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
}

function sanitizeName(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = normalized || 'tool';
  return /^[A-Za-z_]/.test(safe) ? safe : `t_${safe}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

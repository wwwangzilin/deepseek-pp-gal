import type {
  BrowserSnapshotNode,
  BrowserSnapshotResult,
} from './types';

interface AxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  description?: { value?: unknown };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{
    name?: string;
    value?: { value?: unknown };
  }>;
}

interface SnapshotInput {
  axNodes: AxNode[];
  url: string;
  title: string;
  maxNodes: number;
  maxTextBytes: number;
}

export interface FormattedSnapshot {
  result: BrowserSnapshotResult;
  uidToBackendNodeId: Map<string, number>;
}

export function formatAccessibilitySnapshot(input: SnapshotInput): FormattedSnapshot {
  const uidToBackendNodeId = new Map<string, number>();
  const normalized = input.axNodes.filter((node) => !node.ignored);
  const byId = new Map<string, AxNode>();
  const referenced = new Set<string>();
  for (const node of normalized) {
    if (node.nodeId) byId.set(node.nodeId, node);
    for (const childId of node.childIds ?? []) referenced.add(childId);
  }

  const roots = normalized.filter((node) => node.nodeId && !referenced.has(node.nodeId));
  const queue: Array<{ node: AxNode; level: number }> = roots.length > 0
    ? roots.map((node) => ({ node, level: 0 }))
    : normalized.map((node) => ({ node, level: 0 }));

  const nodes: BrowserSnapshotNode[] = [];
  const seen = new Set<string>();
  let text = `URL: ${input.url || '(unknown)'}\nTitle: ${input.title || '(untitled)'}\n`;
  let truncated = false;

  while (queue.length > 0) {
    const { node, level } = queue.shift()!;
    if (node.nodeId && seen.has(node.nodeId)) continue;
    if (node.nodeId) seen.add(node.nodeId);

    const normalizedNode = toSnapshotNode(node, nodes.length + 1, level);
    if (!shouldIncludeNode(normalizedNode)) {
      enqueueChildren(queue, node, byId, level);
      continue;
    }

    if (nodes.length >= input.maxNodes) {
      truncated = true;
      break;
    }

    nodes.push(normalizedNode);
    if (normalizedNode.backendDOMNodeId !== undefined) {
      uidToBackendNodeId.set(normalizedNode.uid, normalizedNode.backendDOMNodeId);
    }

    const nextLine = formatSnapshotLine(normalizedNode);
    if (text.length + nextLine.length > input.maxTextBytes) {
      truncated = true;
      break;
    }
    text += nextLine;

    enqueueChildren(queue, node, byId, level);
  }

  if (truncated) text += '\n...[snapshot truncated]';

  return {
    result: {
      url: input.url,
      title: input.title,
      text,
      nodes,
      truncated,
    },
    uidToBackendNodeId,
  };
}

function toSnapshotNode(node: AxNode, index: number, level: number): BrowserSnapshotNode {
  const properties = new Map(
    (node.properties ?? [])
      .filter((item) => item.name)
      .map((item) => [item.name!, item.value?.value]),
  );

  return {
    uid: `e${index}`,
    role: readAxValue(node.role?.value) || 'node',
    name: readAxValue(node.name?.value),
    value: readOptionalAxValue(node.value?.value),
    description: readOptionalAxValue(node.description?.value),
    disabled: properties.get('disabled') === true,
    focused: properties.get('focused') === true,
    selected: properties.get('selected') === true,
    checked: normalizeChecked(properties.get('checked')),
    level,
    backendDOMNodeId: node.backendDOMNodeId,
  };
}

function enqueueChildren(
  queue: Array<{ node: AxNode; level: number }>,
  node: AxNode,
  byId: Map<string, AxNode>,
  level: number,
): void {
  const children = (node.childIds ?? [])
    .map((id) => byId.get(id))
    .filter((child): child is AxNode => Boolean(child));
  for (const child of children) queue.push({ node: child, level: level + 1 });
}

function shouldIncludeNode(node: BrowserSnapshotNode): boolean {
  if (node.role === 'generic' && !node.name && !node.value && !node.backendDOMNodeId) return false;
  if (node.role === 'none' && !node.name && !node.value) return false;
  return Boolean(node.role || node.name || node.value || node.description);
}

function formatSnapshotLine(node: BrowserSnapshotNode): string {
  const parts = [`${'  '.repeat(Math.min(node.level, 8))}[${node.uid}]`, node.role];
  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.value) parts.push(`value=${JSON.stringify(node.value)}`);
  if (node.checked !== undefined) parts.push(`checked=${node.checked}`);
  if (node.selected) parts.push('selected');
  if (node.focused) parts.push('focused');
  if (node.disabled) parts.push('disabled');
  return `\n${parts.join(' ')}`;
}

function readAxValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function readOptionalAxValue(value: unknown): string | undefined {
  const text = readAxValue(value);
  return text || undefined;
}

function normalizeChecked(value: unknown): boolean | 'mixed' | undefined {
  if (value === true || value === false || value === 'mixed') return value;
  return undefined;
}

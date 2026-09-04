import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addAgentToolEntry,
  adoptReasoningBlock,
  autoCollapseCompletedReasoningHost,
  collapseAllAgentToolGroups,
  createAgentContainer,
  createAgentStartingElement,
  createAgentStepElement,
  finalizePendingAgentToolEntries,
  getAgentConsoleBody,
  getAgentReasoningNote,
  injectInlineAgentStyles,
  isInlineAgentBudgetFinalText,
  mountAgentNarration,
  updateAgentReasoningNoteElement,
  renderAgentStreamText,
  resolveAgentToolEntry,
  updateAgentConsoleHeader,
  updateStepStatus,
  updateStepStreamText,
  hydrateAgentStepCodeRunners,
  type AgentCodeRunResult,
  type InlineAgentRendererLabels,
} from '../core/inline-agent/renderer';
import type { ToolExecutionRecord } from '../core/types';

const streamLabels: Partial<InlineAgentRendererLabels> = {
  stop: 'Stop',
  toolOk: 'Executed',
  toolError: 'Execution failed',
  toolGroup: (count: number) => `Ran ${count} tools`,
};

function makeExecution(
  name: string,
  result: ToolExecutionRecord['result'],
): ToolExecutionRecord {
  return {
    name,
    provider: {
      kind: 'local',
      id: 'web',
      displayName: 'DeepSeek++ Web Search',
      transport: 'in_process',
    },
    result,
  };
}

describe('inline agent renderer', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('renders the stream shell without a card or collapse control', () => {
    const onStop = vi.fn();
    const container = createAgentContainer(onStop, { stop: 'Stop', starting: 'Starting…' });

    expect(container.getAttribute('data-console-phase')).toBe('starting');
    expect(container.querySelector('.dpp-agent-status-text')?.textContent).toBe('Starting…');
    expect(container.querySelector('.dpp-agent-stream')).not.toBeNull();
    // No console shell: no header toggle, no collapse attribute, no card.
    expect(container.querySelector('.dpp-agent-console-toggle')).toBeNull();
    expect(container.hasAttribute('data-console-collapsed')).toBe(false);
    expect(getAgentConsoleBody(container)?.className).toBe('dpp-agent-stream');

    container.querySelector<HTMLButtonElement>('.dpp-agent-stop-btn')?.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('renders status line terminal states as distinct complete/paused/error', () => {
    const complete = createAgentContainer();
    updateAgentConsoleHeader(complete, {
      phase: 'complete',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
    });
    expect(complete.getAttribute('data-console-phase')).toBe('complete');
    expect(complete.querySelector('.dpp-agent-status-text')?.textContent)
      .toBe('Complete · 2 steps · 3 tool calls · 7s');
    expect(complete.querySelector('.dpp-agent-status-dot')).not.toBeNull();

    const paused = createAgentContainer();
    updateAgentConsoleHeader(paused, {
      phase: 'paused',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
    });
    expect(paused.getAttribute('data-console-phase')).toBe('paused');
    expect(paused.querySelector('.dpp-agent-status-text')?.textContent)
      .toBe('Paused · 2 steps · 3 tool calls · 7s');

    const stopped = createAgentContainer();
    updateAgentConsoleHeader(stopped, {
      phase: 'paused',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 7,
      labelOverride: 'Stopped',
    });
    expect(stopped.querySelector('.dpp-agent-status-text')?.textContent).toBe('Stopped');

    const error = createAgentContainer();
    updateAgentConsoleHeader(error, {
      phase: 'error',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
      labelOverride: 'boom',
    });
    expect(error.getAttribute('data-console-phase')).toBe('error');
    expect(error.querySelector('.dpp-agent-status-text')?.textContent).toBe('boom');
  });

  it('hides the stop control in terminal states', () => {
    const container = createAgentContainer(() => undefined, { stop: 'Stop' });
    const stopBtn = container.querySelector<HTMLButtonElement>('.dpp-agent-stop-btn');
    expect(stopBtn?.hidden).toBe(false);

    updateAgentConsoleHeader(container, {
      phase: 'running',
      stepNumber: 0,
      toolCount: 1,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 2,
    });
    expect(stopBtn?.hidden).toBe(false);

    updateAgentConsoleHeader(container, {
      phase: 'complete',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 1,
      totalTools: 1,
      elapsedSeconds: 2,
    });
    expect(stopBtn?.hidden).toBe(true);
  });

  it('renders the console running state with live counts and elapsed time', () => {
    const labels = {
      running: (stepNumber: number, toolCount: number, elapsedSeconds: number) =>
        `RUN ${stepNumber + 1}/${toolCount}/${elapsedSeconds}`,
      stop: 'Stop',
    };
    const container = createAgentContainer(() => undefined, labels);

    updateAgentConsoleHeader(container, {
      phase: 'running',
      stepNumber: 1,
      toolCount: 3,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 5,
    }, labels);

    expect(container.getAttribute('data-console-phase')).toBe('running');
    expect(container.querySelector('.dpp-agent-status-text')?.textContent).toBe('RUN 2/3/5');
    expect(container.querySelector('.dpp-agent-stop-btn')?.textContent).toBe('Stop');
  });

  it('renders streaming markdown while preserving the raw step text', () => {
    const step = createAgentStepElement(0);

    updateStepStreamText(step, [
      '### Market summary',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| **Average price** | 47k |',
    ].join('\n'));

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');

    expect(body?.getAttribute('data-dpp-raw-text')).toContain('| Metric | Value |');
    expect(body?.innerHTML).toContain('<h3>Market summary</h3>');
    expect(body?.innerHTML).toContain('<table>');
    expect(body?.innerHTML).toContain('<td><strong>Average price</strong></td>');
  });

  it('renders agent-mode step text without blank rows between lines', () => {
    const step = createAgentStepElement(0);

    updateStepStreamText(step, [
      '现在我已经获取了足够的搜索结果。让我从这些结果中提炼出最重要的科技新闻。',
      '',
      '从搜索结果中，我可以看到当天有几个重大科技新闻：',
      '',
      '1. 远景科技集团的乌兰察布星河基地投产。',
      '',
      '2. 谷歌AI部门发生重大调整。',
      '',
      '3. 新华网报道了中国的一些科技进展。',
    ].join('\n'));

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body?.innerHTML).not.toContain('<br>');
    expect(body?.innerHTML).toContain('</p><p>从搜索结果中，我可以看到当天有几个重大科技新闻：</p>');
    expect(body?.innerHTML).toContain('<ol><li>远景科技集团的乌兰察布星河基地投产。</li><li>谷歌AI部门发生重大调整。</li><li>新华网报道了中国的一些科技进展。</li></ol>');
  });

  it('removes a narration segment when its text is cleared', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    const step = createAgentStepElement(0);
    updateStepStreamText(step, 'working');
    if (stream) mountAgentNarration(step, stream);

    expect(step.parentElement).toBe(stream);
    updateStepStreamText(step, '');
    expect(step.parentElement).toBeNull();
  });

  it('mounts narration after earlier segments and seals the tool group', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    const step0 = createAgentStepElement(0);
    updateStepStreamText(step0, 'first notes');
    if (stream) mountAgentNarration(step0, stream);
    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'x' } }, streamLabels);

    const step1 = createAgentStepElement(1);
    updateStepStreamText(step1, 'second notes');
    if (stream) mountAgentNarration(step1, stream);

    // Narration of step 1 lands AFTER the step-0 tool group; the group is
    // sealed (collapsed) by the narration. Each narration is preceded by its
    // folded reasoning note.
    const children = Array.from(stream?.children ?? []);
    expect(children[0]?.classList.contains('dpp-agent-reasoning-note')).toBe(true);
    expect(children[1]).toBe(step0);
    expect(children[2]?.classList.contains('dpp-agent-tool-group')).toBe(true);
    expect(children[3]?.classList.contains('dpp-agent-reasoning-note')).toBe(true);
    expect(children[4]).toBe(step1);
    expect(children[2]?.getAttribute('data-collapsed')).toBe('true');

    // A later tool call starts a fresh group (narration separated them).
    if (stream) addAgentToolEntry(stream, 1, { name: 'web_fetch', payload: { url: 'https://a' } }, streamLabels);
    const groups = stream?.querySelectorAll(':scope > .dpp-agent-tool-group') ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelectorAll('.dpp-agent-tool-item')).toHaveLength(1);
    expect(groups[1]?.querySelectorAll('.dpp-agent-tool-item')).toHaveLength(1);
  });

  it('inserts a late narration before its own step tool group', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    // Tools detected before any text (defensive ordering).
    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'x' } }, streamLabels);

    const step = createAgentStepElement(0);
    updateStepStreamText(step, 'notes arriving late');
    if (stream) mountAgentNarration(step, stream);

    const children = Array.from(stream?.children ?? []);
    expect(children[0]?.classList.contains('dpp-agent-reasoning-note')).toBe(true);
    expect(children[1]).toBe(step);
    expect(children[2]?.classList.contains('dpp-agent-tool-group')).toBe(true);
  });

  it('renders a folded per-step reasoning note that expands on click', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    const step = createAgentStepElement(0);
    updateStepStreamText(step, 'notes');
    if (stream) {
      mountAgentNarration(step, stream, {
        ...streamLabels,
        reasoningStep: (n) => `Thought ${n + 1}`,
        reasoningNotPersisted: 'not retained',
      });
    }

    const note = stream?.querySelector<HTMLElement>('.dpp-agent-reasoning-note');
    const toggle = note?.querySelector<HTMLButtonElement>('.dpp-agent-reasoning-note-toggle');
    const body = note?.querySelector<HTMLElement>('.dpp-agent-reasoning-note-body');
    expect(toggle?.textContent).toContain('Thought 1');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(body?.hidden).toBe(false);
    expect(body?.textContent).toBe('not retained');

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
  });

  it('merges consecutive textless steps into one tool group', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'a' } }, streamLabels);
    if (stream) addAgentToolEntry(stream, 1, { name: 'web_fetch', payload: { url: 'https://b' } }, streamLabels);

    const groups = stream?.querySelectorAll(':scope > .dpp-agent-tool-group') ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.querySelectorAll('.dpp-agent-tool-item')).toHaveLength(2);
    expect(groups[0]?.querySelector('.dpp-agent-tool-group-title')?.textContent).toBe('Ran 2 tools');
  });

  it('renders each tool call as a single-line entry with param summary', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) {
      addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: '天气' } }, streamLabels);
    }

    const item = stream?.querySelector('.dpp-agent-tool-item');
    expect(item?.getAttribute('data-tool-status')).toBe('pending');
    expect(item?.querySelector('.dpp-agent-tool-name')?.textContent).toBe('web_search');
    expect(item?.querySelector('.dpp-agent-tool-param')?.textContent).toBe('· 天气');
    expect(item?.querySelector('.dpp-agent-tool-state')?.textContent).toBe('');
    const detail = item?.querySelector<HTMLElement>('.dpp-agent-tool-summary');
    expect(detail?.hidden).toBe(true);
  });

  it('completes a pending tool entry with its execution result', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'x' } }, streamLabels);

    const execution = makeExecution('web_search', {
      ok: true,
      summary: 'found 5 results',
      detail: 'Top hit: example.com',
    });
    if (stream) resolveAgentToolEntry(stream, 0, execution, streamLabels);

    const item = stream?.querySelector('.dpp-agent-tool-item');
    expect(item?.getAttribute('data-tool-status')).toBe('ok');
    expect(item?.querySelector('.dpp-agent-tool-state')?.textContent).toBe('Executed');
    // The payload param summary survives on the line; the result goes to the
    // expanded detail.
    expect(item?.querySelector('.dpp-agent-tool-param')?.textContent).toBe('· x');

    const toggle = item?.querySelector<HTMLButtonElement>('.dpp-agent-tool-toggle');
    const detail = item?.querySelector<HTMLElement>('.dpp-agent-tool-summary');
    expect(detail?.hidden).toBe(true);

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(detail?.hidden).toBe(false);
    expect(detail?.textContent).toContain('found 5 results');
    expect(detail?.textContent).toContain('Top hit: example.com');

    toggle?.click();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(detail?.hidden).toBe(true);
  });

  it('pairs detected entries with their executions in order', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'a' } }, streamLabels);
    if (stream) addAgentToolEntry(stream, 0, { name: 'web_fetch', payload: { url: 'https://b' } }, streamLabels);

    if (stream) resolveAgentToolEntry(stream, 0, makeExecution('web_search', { ok: true, summary: 'first' }), streamLabels);
    if (stream) resolveAgentToolEntry(stream, 0, makeExecution('web_fetch', { ok: false, summary: 'second failed' }), streamLabels);

    const items = stream?.querySelectorAll('.dpp-agent-tool-item') ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('data-tool-status')).toBe('ok');
    expect(items[1]?.getAttribute('data-tool-status')).toBe('err');
    expect(items[1]?.querySelector('.dpp-agent-tool-state')?.textContent).toBe('Execution failed');
  });

  it('creates a completed row when no pending detection exists (restore path)', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) {
      resolveAgentToolEntry(stream, 2, makeExecution('mcp_tool', { ok: true, summary: 'done' }), streamLabels);
    }

    const item = stream?.querySelector('.dpp-agent-tool-item');
    expect(item?.getAttribute('data-tool-status')).toBe('ok');
    expect(item?.querySelector('.dpp-agent-tool-param')?.textContent).toBe('· done');
    expect(item?.querySelector('.dpp-agent-tool-state')?.textContent).toBe('Executed');
  });

  it('bounds long result details with the explicit truncation marker', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    const huge = 'x'.repeat(5000);
    if (stream) {
      resolveAgentToolEntry(stream, 0, makeExecution('shell_exec', {
        ok: true,
        summary: 'ok',
        detail: huge,
        output: { big: huge },
      }), streamLabels);
    }

    const detail = stream?.querySelector<HTMLElement>('.dpp-agent-tool-summary');
    const toggle = stream?.querySelector<HTMLButtonElement>('.dpp-agent-tool-toggle');
    toggle?.click();
    expect(detail?.hidden).toBe(false);
    expect(detail?.textContent).toContain('...[truncated]');
    expect(detail?.textContent).toContain('output:');
  });

  it('marks unresolved pending entries as interrupted on terminal cleanup', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'x' } }, streamLabels);
    if (stream) resolveAgentToolEntry(stream, 0, makeExecution('web_search', { ok: true, summary: 'done' }), streamLabels);
    if (stream) addAgentToolEntry(stream, 1, { name: 'web_fetch', payload: { url: 'https://b' } }, streamLabels);

    if (stream) finalizePendingAgentToolEntries(stream);

    const items = stream?.querySelectorAll('.dpp-agent-tool-item') ?? [];
    expect(items[0]?.getAttribute('data-tool-status')).toBe('ok');
    expect(items[1]?.getAttribute('data-tool-status')).toBe('interrupted');
  });

  it('collapses tool groups at completion unless the user toggled them', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    if (stream) addAgentToolEntry(stream, 0, { name: 'web_search', payload: { query: 'a' } }, streamLabels);
    if (stream) addAgentToolEntry(stream, 1, { name: 'web_fetch', payload: { url: 'https://b' } }, streamLabels);

    // The second group is still the current one (open). Manually expand the
    // first group so auto-collapse must defer to the user.
    const groups = stream?.querySelectorAll(':scope > .dpp-agent-tool-group') ?? [];
    expect(groups).toHaveLength(1);
    groups[0]?.querySelector<HTMLButtonElement>('.dpp-agent-tool-group-toggle')?.click();
    expect(groups[0]?.getAttribute('data-user-toggled')).toBe('true');

    // Separate the two steps with narration so a second group forms.
    const step = createAgentStepElement(1);
    updateStepStreamText(step, 'notes');
    if (stream) mountAgentNarration(step, stream);
    if (stream) addAgentToolEntry(stream, 2, { name: 'browser_click', payload: {} }, streamLabels);

    const after = stream?.querySelectorAll(':scope > .dpp-agent-tool-group') ?? [];
    expect(after).toHaveLength(2);
    expect(after[0]?.getAttribute('data-collapsed')).toBe('true'); // sealed
    expect(after[1]?.getAttribute('data-collapsed')).toBe('false'); // open

    // User re-expands the first group; completion collapse must not override.
    after[0]?.querySelector<HTMLButtonElement>('.dpp-agent-tool-group-toggle')?.click();
    expect(after[0]?.getAttribute('data-collapsed')).toBe('false');

    if (stream) collapseAllAgentToolGroups(stream);
    expect(after[0]?.getAttribute('data-collapsed')).toBe('false'); // user-toggled
    expect(after[1]?.getAttribute('data-collapsed')).toBe('true'); // auto-collapsed
  });

  it('recognizes the exact budget-exhaustion notice as a paused final text', () => {
    const noticeFor = (count: number) => `paused after ${count} rounds`;
    expect(isInlineAgentBudgetFinalText('paused after 3 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 25 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 27 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 28 rounds', noticeFor)).toBe(false);
    expect(isInlineAgentBudgetFinalText('Here is the final answer.', noticeFor)).toBe(false);
    expect(isInlineAgentBudgetFinalText('', noticeFor)).toBe(false);
  });

  it('adopts native reasoning hosts idempotently without moving them', () => {
    const host = document.createElement('div');
    expect(host.parentElement).toBeNull();

    expect(adoptReasoningBlock(host)).toBe(true);
    expect(host.classList.contains('dpp-agent-reasoning-adopted')).toBe(true);
    expect(host.parentElement).toBeNull();

    expect(adoptReasoningBlock(host)).toBe(false);
  });

  it('mounts a reasoning note carrying the real captured thinking text', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    const step = createAgentStepElement(0);
    expect(stream).not.toBeNull();
    if (!stream) return;
    mountAgentNarration(step, stream, streamLabels, '我先分析数据再下结论。');

    const note = getAgentReasoningNote(step);
    expect(note).not.toBeNull();
    const title = note?.querySelector('.dpp-agent-reasoning-note-title');
    expect(title?.textContent).toBe('Thought · step 1');
    const body = note?.querySelector<HTMLElement>('.dpp-agent-reasoning-note-body');
    expect(body?.textContent).toBe('我先分析数据再下结论。');
    // The note is folded by default.
    expect(body?.hidden).toBe(true);
    // Expanding reveals the real content, not the placeholder.
    const toggle = note?.querySelector<HTMLButtonElement>('.dpp-agent-reasoning-note-toggle');
    toggle?.click();
    expect(body?.hidden).toBe(false);
    expect(body?.textContent).not.toContain('not retained');
  });

  it('fills a placeholder reasoning note with live reasoning deltas', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    const step = createAgentStepElement(1);
    expect(stream).not.toBeNull();
    if (!stream) return;
    mountAgentNarration(step, stream, streamLabels);

    const note = getAgentReasoningNote(step);
    expect(note).not.toBeNull();
    let body = note?.querySelector<HTMLElement>('.dpp-agent-reasoning-note-body');
    expect(body?.textContent).toContain('not retained');

    if (note) updateAgentReasoningNoteElement(note, '先');
    if (note) updateAgentReasoningNoteElement(note, '先分析');
    body = note?.querySelector<HTMLElement>('.dpp-agent-reasoning-note-body');
    expect(body?.textContent).toBe('先分析');
    expect(body?.textContent).not.toContain('not retained');
  });

  it('does not mutate the reasoning note for empty updates', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    const step = createAgentStepElement(2);
    expect(stream).not.toBeNull();
    if (!stream) return;
    mountAgentNarration(step, stream, streamLabels, 'real content');
    const note = getAgentReasoningNote(step);
    if (note) updateAgentReasoningNoteElement(note, '');
    const body = note?.querySelector<HTMLElement>('.dpp-agent-reasoning-note-body');
    expect(body?.textContent).toBe('real content');
  });

  it('marks interrupted steps as neutral instead of frozen streaming', () => {
    const step = createAgentStepElement(0);
    updateStepStatus(step, 'interrupted');
    expect(step.getAttribute('data-status')).toBe('interrupted');
  });

  it('uses the shared injected theme and drops the card shell', () => {
    injectInlineAgentStyles();

    const agentStyle = document.getElementById('dpp-inline-agent-css');
    expect(document.getElementById('dpp-injected-theme-css')).not.toBeNull();
    const css = agentStyle?.textContent ?? '';
    expect(css).toContain('color: var(--dpp-ui-text);');
    expect(css).toContain('color: var(--dpp-ui-accent);');
    expect(css).not.toContain('var(--ds-text');
    // No card shell: no console header/toggle, no vertical rail, no collapse.
    expect(css).not.toContain('.dpp-agent-console-header');
    expect(css).not.toContain('.dpp-agent-console-toggle');
    expect(css).not.toContain('.dpp-agent-container::before');
    expect(css).not.toContain('.dpp-agent-step-header');
    // Stream pieces are present.
    expect(css).toContain('.dpp-agent-status-line');
    expect(css).toContain('.dpp-agent-stream');
    expect(css).toContain('.dpp-agent-tool-group-toggle');
    expect(css).toContain('.dpp-agent-tool-param');
    expect(css).toContain('.dpp-agent-reasoning-adopted');
    expect(css).toContain('@keyframes dpp-agent-console-pulse');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('data:image/svg+xml');
  });

  it('exposes the status line as a polite live region with a dot', () => {
    const el = createAgentContainer(() => undefined, { stop: 'Stop' });
    const text = el.querySelector<HTMLElement>('.dpp-agent-status-text');
    expect(text?.getAttribute('role')).toBe('status');
    expect(text?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.dpp-agent-status-dot')).not.toBeNull();
  });

  it('renders the starting placeholder with a live status region', () => {
    const el = createAgentStartingElement({ starting: 'Starting…' });
    expect(el.className).toContain('dpp-agent-starting');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toBe('Starting…');
  });

  it('omits native deliverable fences from the agent console', () => {
    const html = renderAgentStreamText([
      '我生成了文件。',
      '',
      '````HTML',
      '<h1>Hi</h1>',
      '````',
      '',
      '图表如下。',
      '',
      '```xychart-beta',
      'title Revenue',
      'line [1, 2, 3]',
      '```',
      '',
      '交付完成。',
    ].join('\n'));

    expect(html).toContain('<p>我生成了文件。</p>');
    expect(html).toContain('<p>图表如下。</p>');
    expect(html).toContain('<p>交付完成。</p>');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('&lt;h1&gt;Hi&lt;/h1&gt;');
    expect(html).not.toContain('xychart-beta');
    expect(html).not.toContain('dpp-agent-artifact-preview');
    expect(html).not.toContain('iframe');
  });

  it('hides an unterminated native fence throughout streaming without losing raw text', () => {
    const step = createAgentStepElement(0);
    const streamed = '交付物生成中。\n\n```html\n<!DOCTYPE html>\n<html>';

    updateStepStreamText(step, streamed);

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body?.getAttribute('data-dpp-raw-text')).toBe(streamed);
    expect(body?.textContent).toContain('交付物生成中。');
    expect(body?.querySelector('pre')).toBeNull();
    expect(body?.textContent).not.toContain('<!DOCTYPE html>');
  });

  it('leaves non-artifact narration as plain markdown', () => {
    const html = renderAgentStreamText('普通正文 **加粗**。\n\n```js\nx\n```');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<pre data-dpp-lang="js"><code>x\n</code></pre>');
    expect(html).not.toContain('dpp-agent-artifact-preview');
  });


  it('never restores native deliverables as plugin preview placeholders or code frames', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();
    if (stream) {
      stream.innerHTML = renderAgentStreamText('说明。\n\n````html\n<h1>Hi</h1>\n````');
    }
    expect(stream?.textContent).toContain('说明。');
    expect(stream?.querySelector('pre')).toBeNull();
    expect(stream?.querySelector('iframe')).toBeNull();
    expect(stream?.querySelector('.dpp-agent-artifact-preview')).toBeNull();
  });

  it('follows the page scroll while the reader is at the bottom', () => {
    const container = createAgentContainer();
    const stream = getAgentConsoleBody(container);
    expect(stream).not.toBeNull();

    // A scrollable ancestor (the DeepSeek chat scroller).
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    scroller.appendChild(container);

    const step = createAgentStepElement(0);
    if (stream) mountAgentNarration(step, stream);
    // Reader near the bottom (within the 24px tolerance): the stream snaps to
    // the new bottom as content grows.
    scroller.scrollTop = 1590;
    updateStepStreamText(step, 'line 1\nline 2');
    expect(scroller.scrollTop).toBe(2000);

    // A reader who scrolled up is never yanked down.
    scroller.scrollTop = 500;
    updateStepStreamText(step, 'line 1\nline 2\nline 3');
    expect(scroller.scrollTop).toBe(500);
  });

  it('auto-collapses a native reasoning host once its thinking completes', () => {
    const host = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = '已思考（用时 2 秒）';
    const body = document.createElement('div');
    body.textContent = 'thinking content';
    host.append(title, body);
    const onClick = vi.fn();
    title.addEventListener('click', onClick);

    expect(autoCollapseCompletedReasoningHost(host)).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(host.getAttribute('data-dpp-reasoning-auto-folded')).toBe('true');

    // Idempotent: never folded twice, so a manual expand survives.
    expect(autoCollapseCompletedReasoningHost(host)).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fold a reasoning host that is still thinking', () => {
    const host = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = '思考中…';
    const onClick = vi.fn();
    title.addEventListener('click', onClick);
    host.appendChild(title);

    expect(autoCollapseCompletedReasoningHost(host)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(host.hasAttribute('data-dpp-reasoning-auto-folded')).toBe(false);
  });

  it('adds the incremental run action only to non-native code languages', () => {
    // DeepSeek presents html/svg/xml/mermaid itself; xychart shorthand is
    // normalized to Mermaid in stored history. The plugin only adds a run action for
    // languages the native
    // pipeline does not run (javascript/typescript/python).
    const step = createAgentStepElement(0);
    updateStepStreamText(step, [
      '```python',
      'print(1)',
      '```',
      '',
      '```html',
      '<h1>native</h1>',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n'));

    const runCode = vi.fn(async () => ({ ok: true, output: { stdout: '1' } }));
    hydrateAgentStepCodeRunners(step, runCode, {
      codeRun: 'Run',
      codeRunning: 'Running…',
      codeRunFailed: 'Run failed',
    });

    const pythonPre = step.querySelector<HTMLElement>('pre[data-dpp-lang="python"]');
    expect(pythonPre).not.toBeNull();
    const runButton = pythonPre?.nextElementSibling?.querySelector('.dpp-agent-code-run') ?? null;
    expect(runButton).not.toBeNull();
    expect(runButton?.textContent).toBe('Run');

    // Native deliverables never become plugin-owned <pre> elements at all;
    // only the non-native Python block can receive the incremental runner.
    expect(step.querySelector('pre[data-dpp-lang="html"]')).toBeNull();
    expect(step.querySelector('pre[data-dpp-lang="mermaid"]')).toBeNull();
    expect(step.querySelectorAll('.dpp-agent-code-run')).toHaveLength(1);

    // Clicking runs the block's code through the injected runner and shows
    // the output.
    runButton?.dispatchEvent(new MouseEvent('click'));
    expect(runCode).toHaveBeenCalledWith('print(1)\n', 'python');
  });

  it('renders run failures and keeps the run action usable', async () => {
    const step = createAgentStepElement(0);
    updateStepStreamText(step, '```js\nconsole.log(1)\n```');

    const runCode = vi.fn(async () => ({ ok: false, error: { message: 'boom' } }));
    hydrateAgentStepCodeRunners(step, runCode, {
      codeRun: 'Run',
      codeRunning: 'Running…',
      codeRunFailed: 'Run failed',
    });

    const runButton = step.querySelector<HTMLButtonElement>('.dpp-agent-code-run');
    expect(runButton).not.toBeNull();
    runButton?.dispatchEvent(new MouseEvent('click'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const output = step.querySelector<HTMLElement>('.dpp-agent-code-run-output');
    expect(output?.textContent).toContain('boom');
  });

  it('skips the DOM rebuild when a stream chunk repeats the identical clamped text', () => {
    const step = createAgentStepElement(0);
    updateStepStreamText(step, '```python\nprint(1)\n```\n\n正文。');
    const pre = step.querySelector('pre[data-dpp-lang="python"]');
    expect(pre).not.toBeNull();

    // A later frame whose clamped display text is byte-identical (the step
    // render clamp caps every frame once the display cap is reached) must
    // not rebuild the body: element identity is preserved.
    updateStepStreamText(step, '```python\nprint(1)\n```\n\n正文。');
    expect(step.querySelector('pre[data-dpp-lang="python"]')).toBe(pre);
    expect(step.querySelectorAll('pre[data-dpp-lang="python"]')).toHaveLength(1);
    expect(step.querySelector('.dpp-agent-step-body')?.getAttribute('data-dpp-raw-text'))
      .toBe('```python\nprint(1)\n```\n\n正文。');
  });

  it('preserves an in-flight code run across a step-body re-render', async () => {
    const step = createAgentStepElement(0);
    updateStepStreamText(step, '```python\nprint(1)\n```');

    let resolveRun!: (result: AgentCodeRunResult) => void;
    const runCode = vi.fn(
      () => new Promise<AgentCodeRunResult>((resolve) => {
        resolveRun = resolve;
      }),
    );
    const labels = { codeRun: 'Run', codeRunning: 'Running…' };
    hydrateAgentStepCodeRunners(step, runCode, labels);

    const firstButton = step.querySelector<HTMLButtonElement>('.dpp-agent-code-run');
    expect(firstButton).not.toBeNull();
    firstButton?.dispatchEvent(new MouseEvent('click'));
    expect(firstButton?.disabled).toBe(true);

    // The stream pushes a new chunk: the body is rebuilt and the row is
    // destroyed; re-hydration must restore the running state instead of a
    // fresh enabled button.
    updateStepStreamText(step, '```python\nprint(1)\n```\n\n更多正文。');
    hydrateAgentStepCodeRunners(step, runCode, labels);
    const rebuiltButton = step.querySelector<HTMLButtonElement>('.dpp-agent-code-run');
    expect(rebuiltButton).not.toBeNull();
    expect(rebuiltButton?.disabled).toBe(true);
    expect(rebuiltButton?.textContent).toBe('Running…');

    // The sandbox settles after the re-render: the output must land on the
    // CURRENT row, not the destroyed one.
    resolveRun({ ok: true, output: { stdout: '1' } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const output = step.querySelector<HTMLElement>('.dpp-agent-code-run-output');
    expect(output?.textContent).toContain('stdout:\n1');
    expect(step.querySelector<HTMLButtonElement>('.dpp-agent-code-run')?.disabled).toBe(false);
    expect(step.querySelector<HTMLButtonElement>('.dpp-agent-code-run')?.textContent).toBe('Run');
  });

  it('marks adopted native reasoning hosts flush with the agent stream', () => {
    injectInlineAgentStyles();
    const rules = [...document.querySelectorAll('style')].map((el) => el.textContent ?? '').join('\n');

    const adoptedRule = rules.match(/\.dpp-agent-reasoning-adopted \{([\s\S]*?)\n    \}/)?.[1] ?? '';
    expect(adoptedRule).toContain('margin: 2px 0;');
    expect(adoptedRule).not.toContain('margin-left: 16px');
    expect(adoptedRule).not.toContain('border-left: 1px');
  });
});

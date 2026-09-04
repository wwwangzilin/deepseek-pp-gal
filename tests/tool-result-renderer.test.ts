import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerDefaultToolResultRenderers,
  renderToolResultWithRegistry,
  userClickGuard,
} from '../core/ui/tool-result-renderer';
import type { ToolCardResult } from '../core/types';

/**
 * Result-card actions are gated on `event.isTrusted` (M2). jsdom cannot
 * synthesize trusted events, so trusted clicks are emulated by swapping the
 * exported userClickGuard holder; the untrusted test keeps the real guard and
 * asserts a plain `element.click()` (isTrusted=false) does nothing.
 */
function trustedClick(element: HTMLElement | null): void {
  if (!element) return;
  element.click();
}

describe('tool result renderer registry', () => {
  beforeEach(() => {
    userClickGuard.isTrusted = () => true;
  });

  afterEach(() => {
    userClickGuard.isTrusted = (event) => event.isTrusted;
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('renders artifact outputs without hardcoding artifact UI in content.ts', () => {
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'File ready',
      output: {
        kind: 'artifact',
        artifactId: 'artifact-1',
        artifactKind: 'file',
        filename: 'report.md',
        mimeType: 'text/markdown',
        sizeBytes: 12,
      },
    };

    const rendered = renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage: vi.fn(),
    });

    expect(rendered).toBe(true);
    expect(target.querySelector('.dpp-artifact-result')).not.toBeNull();
    expect(target.textContent).toContain('report.md');
    expect(target.textContent).toContain('Download');
    expect(document.getElementById('dpp-injected-theme-css')).not.toBeNull();
  });

  it('ignores synthetic (untrusted) clicks on result-card actions (M2)', () => {
    // Restore the real guard: jsdom clicks report isTrusted=false, which is
    // exactly the page-world synthetic-click case the guard must block.
    userClickGuard.isTrusted = (event) => event.isTrusted;
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'Draft ready',
      output: {
        kind: 'skill_draft',
        draft: {
          name: 'audit',
          description: 'Review contrast-sensitive output.',
          instructions: 'Check dark theme text.',
          memoryEnabled: true,
        },
      },
    };
    const sendMessageMock = vi.fn();

    expect(renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage: sendMessageMock,
    })).toBe(true);

    target.querySelector<HTMLButtonElement>('.dpp-result-action')?.click();
    // The save button must exist but the synthetic click must not persist.
    expect(target.querySelector('.dpp-result-action')).not.toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('uses the shared injected theme variables for result text contrast', () => {
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'Draft ready',
      output: {
        kind: 'skill_draft',
        draft: {
          name: 'audit',
          description: 'Review contrast-sensitive output.',
          instructions: 'Check dark theme text.',
          memoryEnabled: true,
        },
      },
    };

    expect(renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage: vi.fn(),
    })).toBe(true);

    const style = document.getElementById('dpp-artifact-result-css');
    expect(style?.textContent).toContain('color: var(--dpp-ui-text);');
    expect(style?.textContent).toContain('color: var(--dpp-ui-text-muted);');
    expect(style?.textContent).not.toContain('body.dpp-theme-dark .dpp-result-text');
  });

  it('opens HTML artifacts in a native-like right-side preview panel only after user action', async () => {
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'File ready',
      output: {
        kind: 'artifact',
        artifactId: 'artifact-html',
        artifactKind: 'file',
        filename: 'demo.html',
        mimeType: 'text/html',
        sizeBytes: 64,
        view: { previewMode: 'html', language: 'html' },
      },
    };
    const sendMessageMock = vi.fn(async () => ({
      ok: true,
      artifact: {
        filename: 'demo.html',
        mimeType: 'text/html',
        content: '<!doctype html><html><body><h1>html-ok</h1><script>console.log("ok")</script></body></html>',
        kind: 'file',
      },
    }));
    const sendMessage = sendMessageMock as unknown as <T = unknown>(message: unknown) => Promise<T | undefined>;

    const rendered = renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage,
    });

    expect(rendered).toBe(true);
    expect(target.querySelector('.dpp-artifact-preview-result')).toBeNull();
    expect(target.querySelector('.dpp-artifact-preview')).not.toBeNull();
    expect(document.body.querySelector('.dpp-artifact-preview-panel')).toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalled();

    trustedClick(target.querySelector<HTMLButtonElement>('.dpp-artifact-preview'));
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.body.querySelector<HTMLElement>('.dpp-artifact-preview-panel');
    const frame = document.body.querySelector<HTMLIFrameElement>('.dpp-artifact-preview-panel-frame');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.dpp-artifact-preview-panel-header')).not.toBeNull();
    expect(panel?.querySelector('.dpp-artifact-preview-panel-stage')).not.toBeNull();
    expect(document.body.classList.contains('dpp-artifact-preview-panel-open')).toBe(true);
    expect(target.textContent).toContain('demo.html');
    expect(target.textContent).not.toContain('html-ok');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame?.srcdoc).toContain('<h1>html-ok</h1>');
  });

  it('opens transient restored HTML artifacts without a background artifact lookup', async () => {
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'File ready',
      output: {
        kind: 'artifact',
        artifactId: 'transient:demo',
        artifactKind: 'file',
        filename: 'demo.html',
        mimeType: 'text/html',
        sizeBytes: 46,
        view: { previewMode: 'html', language: 'html' },
        transientContent: '<!doctype html><html><body><h1>restored-ok</h1></body></html>',
      },
    };
    const sendMessageMock = vi.fn();
    const sendMessage = sendMessageMock as unknown as <T = unknown>(message: unknown) => Promise<T | undefined>;

    const rendered = renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage,
    });

    expect(rendered).toBe(true);
    trustedClick(target.querySelector<HTMLButtonElement>('.dpp-artifact-preview'));
    await Promise.resolve();
    await Promise.resolve();

    const frame = document.body.querySelector<HTMLIFrameElement>('.dpp-artifact-preview-panel-frame');
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(frame?.srcdoc).toContain('<h1>restored-ok</h1>');
  });

  it('closes the artifact preview panel when the page route changes', async () => {
    vi.useFakeTimers();
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'File ready',
      output: {
        kind: 'artifact',
        artifactId: 'artifact-html',
        artifactKind: 'file',
        filename: 'demo.html',
        mimeType: 'text/html',
        sizeBytes: 64,
        view: { previewMode: 'html', language: 'html' },
      },
    };
    const sendMessageMock = vi.fn(async () => ({
      ok: true,
      artifact: {
        filename: 'demo.html',
        mimeType: 'text/html',
        content: '<!doctype html><h1>html-ok</h1>',
        kind: 'file',
      },
    }));
    const sendMessage = sendMessageMock as unknown as <T = unknown>(message: unknown) => Promise<T | undefined>;

    renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage,
    });

    trustedClick(target.querySelector<HTMLButtonElement>('.dpp-artifact-preview'));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.body.querySelector('.dpp-artifact-preview-panel')).not.toBeNull();

    window.history.pushState({}, '', '/a/chat/s/another-session');
    vi.advanceTimersByTime(250);

    expect(document.body.querySelector('.dpp-artifact-preview-panel')).toBeNull();
    expect(document.body.classList.contains('dpp-artifact-preview-panel-open')).toBe(false);
  });

  it('runs Python artifacts through the artifact code runner', async () => {
    registerDefaultToolResultRenderers();
    const target = document.createElement('div');
    const result: ToolCardResult = {
      ok: true,
      summary: 'File ready',
      output: {
        kind: 'artifact',
        artifactId: 'artifact-python',
        artifactKind: 'file',
        filename: 'calc.py',
        mimeType: 'text/x-python',
        sizeBytes: 14,
        view: { previewMode: 'code', language: 'python' },
      },
    };
    const sendMessageMock = vi.fn(async (message: unknown) => {
      const value = message as { type?: string };
      if (value.type === 'GET_ARTIFACT') {
        return {
          ok: true,
          artifact: {
            filename: 'calc.py',
            mimeType: 'text/x-python',
            content: 'print(42)',
            kind: 'file',
          },
        };
      }
      if (value.type === 'RUN_ARTIFACT_CODE') {
        return {
          ok: true,
          summary: 'Sandbox executed',
          output: {
            stdout: '42',
            stderr: '',
            result: '',
          },
        };
      }
      return undefined;
    });
    const sendMessage = sendMessageMock as unknown as <T = unknown>(message: unknown) => Promise<T | undefined>;

    const rendered = renderToolResultWithRegistry({
      target,
      result,
      locale: 'en',
      sendMessage,
    });
    const button = target.querySelector<HTMLButtonElement>('.dpp-artifact-run');
    trustedClick(button);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rendered).toBe(true);
    expect(button).not.toBeNull();
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'RUN_ARTIFACT_CODE',
      payload: {
        language: 'python',
        code: 'print(42)',
        timeoutMs: 15000,
      },
    });
    expect(target.querySelector('.dpp-artifact-run-output')?.textContent).toContain('Code executed');
    expect(target.querySelector('.dpp-artifact-run-output')?.textContent).toContain('stdout:\n42');
  });

});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubTabs } from '../entrypoints/sidepanel/components/settings/primitives';

let container: HTMLDivElement;
let root: Root | null;
let resizeCallback: (() => void) | null = null;

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'api', label: 'API' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'voice', label: 'Voice' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'usage', label: 'Usage' },
  { key: 'data', label: 'Data' },
  { key: 'projectFiles', label: 'Project Files' },
  { key: 'about', label: 'About' },
];

function defineLayout(
  element: HTMLElement,
  layout: { clientWidth?: number; scrollWidth?: number; scrollLeft?: number },
): void {
  if (layout.clientWidth !== undefined) {
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: layout.clientWidth });
  }
  if (layout.scrollWidth !== undefined) {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: layout.scrollWidth });
  }
  if (layout.scrollLeft !== undefined) {
    Object.defineProperty(element, 'scrollLeft', { configurable: true, value: layout.scrollLeft, writable: true });
  }
}

/** Simulate the container resizing: re-runs the component's ResizeObserver. */
async function resize() {
  await act(async () => {
    resizeCallback?.();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  resizeCallback = null;

  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) {
      resizeCallback = callback;
    }
    observe(): void {}
    disconnect(): void {
      resizeCallback = null;
    }
    unobserve(): void {}
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

async function renderSubTabs(props: {
  tabs?: { key: string; label: string }[];
  value?: string;
  onChange?: (key: string) => void;
}) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(SubTabs, {
      tabs: props.tabs ?? TABS,
      value: props.value ?? 'general',
      onChange: props.onChange ?? (() => {}),
      ariaLabel: 'test sub navigation',
    }));
  });
}

async function rerender(value: string) {
  await act(async () => {
    root?.render(React.createElement(SubTabs, {
      tabs: TABS,
      value,
      onChange: () => {},
      ariaLabel: 'test sub navigation',
    }));
  });
}

function nav(): HTMLElement {
  const element = container.querySelector('nav[role="tablist"]');
  expect(element).toBeTruthy();
  return element as HTMLElement;
}

function arrow(direction: 'left' | 'right'): HTMLButtonElement {
  const element = container.querySelector(`.sub-tabs-arrow-${direction}`) as HTMLButtonElement | null;
  expect(element).toBeTruthy();
  return element!;
}

function tabByLabel(label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button[role="tab"]')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined;
  expect(element).toBeTruthy();
  return element!;
}

function stubScrollBy(list: HTMLElement) {
  const scrollBy = vi.fn((options: { left: number }) => {
    const next = Math.max(0, (list.scrollLeft ?? 0) + options.left);
    Object.defineProperty(list, 'scrollLeft', { configurable: true, value: next, writable: true });
    list.dispatchEvent(new Event('scroll'));
  });
  list.scrollBy = scrollBy as unknown as typeof list.scrollBy;
  return scrollBy;
}

describe('SubTabs overflow chevrons', () => {
  it('hides both arrows while the strip fits its container', async () => {
    await renderSubTabs({});
    defineLayout(nav(), { clientWidth: 800, scrollWidth: 800, scrollLeft: 0 });
    await resize();

    expect(arrow('left').disabled).toBe(true);
    expect(arrow('right').disabled).toBe(true);
  });

  it('shows the right arrow on overflow and scrolls by the visible width on click', async () => {
    await renderSubTabs({});
    const list = nav();
    defineLayout(list, { clientWidth: 200, scrollWidth: 800, scrollLeft: 0 });
    const scrollBy = stubScrollBy(list);
    await resize();

    expect(arrow('left').disabled).toBe(true);
    expect(arrow('right').disabled).toBe(false);

    await act(async () => {
      arrow('right').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(scrollBy).toHaveBeenCalledTimes(1);
    const amount = (scrollBy.mock.calls[0] as unknown as [{ left: number }])[0].left;
    // ~70% of the visible width, at least 120px.
    expect(amount).toBeGreaterThanOrEqual(120);
  });

  it('reveals the left arrow after scrolling and hides it again at the start', async () => {
    await renderSubTabs({});
    const list = nav();
    defineLayout(list, { clientWidth: 200, scrollWidth: 800, scrollLeft: 0 });
    stubScrollBy(list);
    await resize();

    await act(async () => {
      arrow('right').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(arrow('left').disabled).toBe(false);

    await act(async () => {
      arrow('left').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(arrow('left').disabled).toBe(true);
    expect(arrow('right').disabled).toBe(false);
  });

  it('keeps the selected tab in view when selection moves off-screen', async () => {
    await renderSubTabs({ value: 'general' });
    const list = nav();
    defineLayout(list, { clientWidth: 200, scrollWidth: 800, scrollLeft: 0 });
    const scrollTo = vi.fn((options: { left: number }) => {
      Object.defineProperty(list, 'scrollLeft', { configurable: true, value: options.left, writable: true });
    });
    list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
    const aboutTab = tabByLabel('About');
    Object.defineProperty(aboutTab, 'offsetLeft', { configurable: true, value: 780 });
    Object.defineProperty(aboutTab, 'offsetWidth', { configurable: true, value: 60 });

    await rerender('about');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const target = (scrollTo.mock.calls[0] as unknown as [{ left: number }])[0].left;
    expect(target).toBe(780 + 60 - 200);
  });

  it('keeps the left/right arrow keyboard navigation working', async () => {
    const onChange = vi.fn();
    await renderSubTabs({ value: 'general', onChange });

    await act(async () => {
      tabByLabel('General').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('api');
  });

  it('has distinct localized aria labels for the arrow buttons', async () => {
    await renderSubTabs({});
    const left = arrow('left').getAttribute('aria-label');
    const right = arrow('right').getAttribute('aria-label');
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left).not.toBe(right);
  });
});

describe('SubTabs reduced motion and CSS contract', () => {
  it('uses auto scrolling when the user prefers reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })),
    });
    await renderSubTabs({ value: 'general' });
    const list = nav();
    defineLayout(list, { clientWidth: 200, scrollWidth: 800, scrollLeft: 0 });
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
    const aboutTab = tabByLabel('About');
    Object.defineProperty(aboutTab, 'offsetLeft', { configurable: true, value: 780 });
    Object.defineProperty(aboutTab, 'offsetWidth', { configurable: true, value: 60 });

    await rerender('about');
    expect((scrollTo.mock.calls[0] as unknown as [{ behavior: string }])[0].behavior).toBe('auto');
  });

  it('keeps the sub-tabs CSS shell and arrow rules in the stylesheet', () => {
    const css = readFileSync(
      resolve(__dirname, '../entrypoints/sidepanel/style.css'),
      'utf8',
    );
    for (const selector of ['.sub-tabs-shell', '.sub-tabs-arrow', '.sub-tabs-arrow-left', '.sub-tabs-arrow-right']) {
      expect(css).toContain(selector);
    }
  });
});

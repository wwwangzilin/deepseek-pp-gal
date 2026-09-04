import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageDailySummary, UsageSummary } from '../core/usage/types';
import UsageSubPage from '../entrypoints/sidepanel/components/settings/UsageSubPage';

let container: HTMLDivElement;
let root: Root | null;
let usageResponse: unknown;

function makeDaily(index: number, total: number): UsageDailySummary {
  return {
    day: `2026-07-${String(index + 1).padStart(2, '0')}`,
    timestamp: Date.now() - (29 - index) * 86_400_000,
    tokens: total,
    messageCount: 1,
    sessionCount: 1,
    turnCount: 1,
    models: [{ modelKey: 'vision', modelLabel: 'DeepSeek Vision', tokens: total }],
  };
}

function makeUsageSummary(rangeDays: 7 | 30): UsageSummary {
  const days = Array.from({ length: rangeDays }, (_, index) => makeDaily(index, 10 + index));
  return {
    rangeDays,
    generatedAt: Date.now(),
    totalTokens: days.reduce((sum, day) => sum + day.tokens, 0),
    sessionCount: rangeDays,
    messageCount: rangeDays * 2,
    turnCount: rangeDays,
    activeDays: rangeDays,
    currentStreak: rangeDays,
    serverTokenRecordCount: rangeDays,
    mostUsedModel: {
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: days.reduce((sum, day) => sum + day.tokens, 0),
      turnCount: rangeDays,
      messageCount: rangeDays * 2,
      sessionCount: rangeDays,
      share: 1,
    },
    days,
    heatmap: days.map((day) => ({ day: day.day, timestamp: day.timestamp, tokens: day.tokens, level: 1 as const })),
    modelUsage: [{
      modelKey: 'vision',
      modelLabel: 'DeepSeek Vision',
      totalTokens: days.reduce((sum, day) => sum + day.tokens, 0),
      turnCount: rangeDays,
      messageCount: rangeDays * 2,
      sessionCount: rangeDays,
      share: 1,
    }],
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  usageResponse = makeUsageSummary(30);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => (
        message.type === 'CLEAR_USAGE_STATS' ? { ok: true } : usageResponse
      )),
    },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderUsagePage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(UsageSubPage));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function trendGrid(): HTMLDivElement {
  const grid = container.querySelector<HTMLDivElement>('.usage-bars');
  expect(grid).toBeTruthy();
  return grid!;
}

function labels(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.usage-bar-label'));
}

describe('usage daily trend X axis', () => {
  it('lets a 30-day chart shrink to the panel width with a dense gap', async () => {
    await renderUsagePage();
    const grid = trendGrid();
    expect(grid.style.getPropertyValue('--usage-day-count')).toBe('30');
    expect(grid.style.getPropertyValue('--usage-bar-gap')).toBe('2px');
    expect(grid.style.gridTemplateColumns).toBe('');
  });

  it('keeps 7-day charts at the regular gap', async () => {
    usageResponse = makeUsageSummary(7);
    await renderUsagePage();
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    await act(async () => {
      lastSevenDays!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const grid = trendGrid();
    expect(grid.style.getPropertyValue('--usage-day-count')).toBe('7');
    expect(grid.style.getPropertyValue('--usage-bar-gap')).toBe('4px');
  });

  it('anchors the first and last X-axis labels inward and skips intermediate labels in 30-day mode', async () => {
    await renderUsagePage();

    const all = labels();
    // 30-day: indices 0, 6, 12, 18, 24 and the last day carry text.
    const visible = all.filter((label) => label.textContent!.trim() !== '');
    expect(visible).toHaveLength(6);
    expect(visible[0].className).toContain('usage-bar-label-first');
    expect(visible[visible.length - 1].className).toContain('usage-bar-label-last');
    expect(visible[0].textContent!.trim()).not.toBe('');
    expect(visible[visible.length - 1].textContent!.trim()).not.toBe('');

    for (const label of all) {
      expect(label.className).toMatch(/^usage-bar-label(?: usage-bar-label-first| usage-bar-label-last)?$/);
    }
  });

  it('uses compact day-only labels in 30-day mode so text fits the narrow columns', async () => {
    await renderUsagePage();

    const visible = labels().filter((label) => label.textContent!.trim() !== '');
    expect(visible).toHaveLength(6);
    for (const label of visible) {
      // Day-only ("3", "27") is ~6-11px wide; "M/D" ("7/15") is ~14-19px and
      // spills over the neighboring bars in the 30-day chart.
      expect(label.textContent!.trim()).not.toContain('/');
    }
  });

  it('labels every day in 7-day mode with anchored edges', async () => {
    usageResponse = makeUsageSummary(7);
    await renderUsagePage();
    const lastSevenDays = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '最近 7 天',
    );
    await act(async () => {
      lastSevenDays!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const visible = labels().filter((label) => label.textContent!.trim() !== '');
    expect(visible).toHaveLength(7);
    expect(visible[0].className).toContain('usage-bar-label-first');
    expect(visible[visible.length - 1].className).toContain('usage-bar-label-last');
    // 7-day columns are wide enough for full M/D labels.
    expect(visible[0].textContent!.trim()).toContain('/');
  });
});

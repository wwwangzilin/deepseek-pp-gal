import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  summarizeUsage,
  toLocalDayKey,
} from '../core/usage/stats';
import {
  getUsageSummary,
  recordUsageTurn,
} from '../core/usage/store';
import type { UsageTurnRecord } from '../core/usage/types';

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('summarizeUsage', () => {
  it('aggregates recent tokens, sessions, streak and model distribution', () => {
    const now = new Date(2026, 5, 18, 12).getTime();
    const yesterday = now - DAY_MS;
    const outsideRange = now - 8 * DAY_MS;

    const summary = summarizeUsage([
      makeRecord({ id: 'old', recordedAt: outsideRange, totalTokens: 999 }),
      makeRecord({ id: 'vision', recordedAt: yesterday, chatSessionId: 'session-a', modelType: 'vision', totalTokens: 100 }),
      makeRecord({ id: 'expert', recordedAt: now, chatSessionId: 'session-b', modelType: 'expert', totalTokens: 240 }),
    ], { rangeDays: 7, now });

    expect(summary.days).toHaveLength(7);
    expect(summary.heatmap).toHaveLength(7);
    expect(summary.totalTokens).toBe(340);
    expect(summary.sessionCount).toBe(2);
    expect(summary.messageCount).toBe(4);
    expect(summary.turnCount).toBe(2);
    expect(summary.activeDays).toBe(2);
    expect(summary.currentStreak).toBe(2);
    expect(summary.serverTokenRecordCount).toBe(2);
    expect(summary.mostUsedModel?.modelLabel).toBe('DeepSeek Expert');
    expect(summary.modelUsage.map((model) => model.modelLabel)).toEqual([
      'DeepSeek Expert',
      'DeepSeek Vision',
    ]);
  });

  it('breaks the current streak when today has no usage', () => {
    const now = new Date(2026, 5, 18, 12).getTime();
    const summary = summarizeUsage([
      makeRecord({ id: 'yesterday', recordedAt: now - DAY_MS, totalTokens: 100 }),
    ], { rangeDays: 7, now });

    expect(summary.activeDays).toBe(1);
    expect(summary.currentStreak).toBe(0);
  });
});

describe('usage store', () => {
  it('upserts later server metrics for the same request id', async () => {
    const { chromeStub } = createChromeStub();
    vi.stubGlobal('chrome', chromeStub);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 18, 12));

    await recordUsageTurn({
      id: 'req-1',
      source: 'deepseek-web',
      totalTokens: 12,
      tokenSource: 'estimated',
      tps: 4,
      speedSource: 'estimated',
      elapsedMs: 3000,
    });
    await recordUsageTurn({
      id: 'req-1',
      source: 'deepseek-web',
      totalTokens: 3302,
      tokenSource: 'server',
      tps: 1061.7,
      speedSource: 'server',
      elapsedMs: 3110,
      modelType: 'vision',
    });

    const summary = await getUsageSummary(30);
    expect(summary.turnCount).toBe(1);
    expect(summary.totalTokens).toBe(3302);
    expect(summary.serverTokenRecordCount).toBe(1);
    expect(summary.mostUsedModel?.modelLabel).toBe('DeepSeek Vision');
  });
});

function makeRecord(overrides: Partial<UsageTurnRecord>): UsageTurnRecord {
  const recordedAt = overrides.recordedAt ?? Date.now();
  return {
    id: overrides.id ?? 'record',
    recordedAt,
    day: overrides.day ?? toLocalDayKey(recordedAt),
    source: overrides.source ?? 'deepseek-web',
    chatSessionId: overrides.chatSessionId ?? 'session',
    assistantMessageId: overrides.assistantMessageId ?? 1,
    modelType: overrides.modelType ?? null,
    totalTokens: overrides.totalTokens ?? 0,
    tokenSource: overrides.tokenSource ?? 'server',
    tps: overrides.tps ?? 10,
    speedSource: overrides.speedSource ?? 'server',
    elapsedMs: overrides.elapsedMs ?? 1000,
    messageCount: overrides.messageCount ?? 2,
  };
}

function createChromeStub() {
  const storage = new Map<string, unknown>();
  return {
    storage,
    chromeStub: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
    },
  };
}

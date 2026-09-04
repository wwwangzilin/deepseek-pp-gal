import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMultimodalSettings,
  getMultimodalNativeEnv,
  saveMultimodalSettings,
} from '../core/multimodal/settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('multimodal settings', () => {
  it('stores provider keys, models, and request URLs for native host injection', async () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) storage.set(key, item);
          }),
          remove: vi.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
    });

    const status = await saveMultimodalSettings({
      openaiApiKey: 'sk-openai',
      geminiApiKey: 'gemini-key',
      openaiImageModel: 'gpt-4.1-mini',
      geminiVideoModel: 'gemini-2.5-flash',
      openaiBaseUrl: 'https://openai-proxy.example/v1/',
      geminiBaseUrl: 'https://gemini-proxy.example/v1beta/',
    });
    const env = await getMultimodalNativeEnv();

    expect(status).toMatchObject({
      openaiConfigured: true,
      geminiConfigured: true,
      openaiBaseUrl: 'https://openai-proxy.example/v1',
      geminiBaseUrl: 'https://gemini-proxy.example/v1beta',
    });
    expect(env).toMatchObject({
      OPENAI_API_KEY: 'sk-openai',
      GEMINI_API_KEY: 'gemini-key',
      OPENAI_IMAGE_MODEL: 'gpt-4.1-mini',
      GEMINI_VIDEO_MODEL: 'gemini-2.5-flash',
      OPENAI_BASE_URL: 'https://openai-proxy.example/v1',
      GEMINI_BASE_URL: 'https://gemini-proxy.example/v1beta',
    });

    await clearMultimodalSettings();
    expect(await getMultimodalNativeEnv()).not.toHaveProperty('OPENAI_API_KEY');
  });
});

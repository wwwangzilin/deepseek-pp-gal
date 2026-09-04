import { content as enContent } from './resources/en/content';
import { background as enBackground } from './resources/en/background';
import { tool as enTool } from './resources/en/tool';
import { prompt as enPrompt } from './resources/en/prompt';
import { content as zhContent } from './resources/zh-CN/content';
import { background as zhBackground } from './resources/zh-CN/background';
import { tool as zhTool } from './resources/zh-CN/tool';
import { prompt as zhPrompt } from './resources/zh-CN/prompt';
import {
  createTranslatorIn,
  getLocaleArrayKeysIn,
  getLocaleStringKeysIn,
  resolveMessageArrayIn,
  resolveMessageIn,
  translateArrayIn,
  translateIn,
  type LocaleResourceSet,
} from './runtime';
import {
  type ArrayLeafPaths,
  type LocaleSchema,
  type MessageParams,
  type ResolvedMessage,
  type ResolvedMessageArray,
  type StringLeafPaths,
  type SupportedLocale,
} from './types';
import type { LocaleMessages } from './resources/zh-CN';

export {
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREFERENCES,
  SUPPORTED_LOCALES,
  type ArrayLeafPaths,
  type LocalePreference,
  type LocaleResourceTree,
  type LocaleSchema,
  type MessageParams,
  type MessageParamValue,
  type ResolvedLocale,
  type ResolvedLocaleState,
  type ResolvedMessage,
  type ResolvedMessageArray,
  type StringLeafPaths,
  type SupportedLocale,
} from './types';

export {
  formatMessage,
  getBrowserLanguageCandidates,
  isLocalePreference,
  isSupportedLocale,
  normalizeLocalePreference,
  normalizeSupportedLocale,
  resolveLocalePreference,
  resolveSupportedLocale,
} from './runtime';

/**
 * Background-only locale resources: only the message sections reachable from
 * background-bundled modules (content, background, tool, prompt). Keeping the
 * sidepanel/app/manifest/locale/pet/common sections out of the service worker
 * bundle is the structural budget win (see issue #505/#506); the key type is
 * narrowed so a background module cannot reference an unavailable key.
 */
export const BACKGROUND_LOCALE_SECTIONS = ['content', 'background', 'tool', 'prompt'] as const;

export type BackgroundLocaleSection = (typeof BACKGROUND_LOCALE_SECTIONS)[number];

export type BackgroundLocaleMessages = {
  content: LocaleSchema<LocaleMessages['content']>;
  background: LocaleSchema<LocaleMessages['background']>;
  tool: LocaleSchema<LocaleMessages['tool']>;
  prompt: LocaleSchema<LocaleMessages['prompt']>;
};

export type LocaleMessageKey = StringLeafPaths<BackgroundLocaleMessages>;
export type LocaleArrayKey = ArrayLeafPaths<BackgroundLocaleMessages>;

export const backgroundLocaleResources: Record<SupportedLocale, BackgroundLocaleMessages> = {
  en: {
    content: enContent,
    background: enBackground,
    tool: enTool,
    prompt: enPrompt,
  },
  'zh-CN': {
    content: zhContent,
    background: zhBackground,
    tool: zhTool,
    prompt: zhPrompt,
  },
};

export function translate(
  localeInput: unknown,
  key: LocaleMessageKey,
  params?: MessageParams,
): string {
  return translateIn(backgroundLocaleResources, localeInput, key, params);
}

export function translateArray(localeInput: unknown, key: LocaleArrayKey): readonly string[] {
  return translateArrayIn(backgroundLocaleResources, localeInput, key);
}

export function createTranslator(localeInput: unknown): {
  locale: SupportedLocale;
  fallback: boolean;
  t: (key: LocaleMessageKey, params?: MessageParams) => string;
  ta: (key: LocaleArrayKey) => readonly string[];
} {
  return createTranslatorIn(backgroundLocaleResources, localeInput);
}

export function resolveMessage(
  localeInput: unknown,
  key: LocaleMessageKey,
  params?: MessageParams,
): ResolvedMessage {
  return resolveMessageIn(backgroundLocaleResources, localeInput, key, params);
}

export function resolveMessageArray(localeInput: unknown, key: LocaleArrayKey): ResolvedMessageArray {
  return resolveMessageArrayIn(backgroundLocaleResources, localeInput, key);
}

export function getLocaleStringKeys(locale: SupportedLocale = 'zh-CN'): string[] {
  return getLocaleStringKeysIn(backgroundLocaleResources, locale);
}

export function getLocaleArrayKeys(locale: SupportedLocale = 'zh-CN'): string[] {
  return getLocaleArrayKeysIn(backgroundLocaleResources, locale);
}

export type { LocaleResourceSet };

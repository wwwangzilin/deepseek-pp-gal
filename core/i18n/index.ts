import { en } from './resources/en';
import { zhCN, type LocaleMessages } from './resources/zh-CN';
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
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREFERENCES,
  SUPPORTED_LOCALES,
  type ArrayLeafPaths,
  type LocalePreference,
  type MessageParams,
  type ResolvedLocale,
  type ResolvedLocaleState,
  type ResolvedMessage,
  type ResolvedMessageArray,
  type StringLeafPaths,
  type SupportedLocale,
} from './types';

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

export type LocaleMessageKey = StringLeafPaths<LocaleMessages>;
export type LocaleArrayKey = ArrayLeafPaths<LocaleMessages>;

export const localeResources: Record<SupportedLocale, LocaleMessages> = {
  'zh-CN': zhCN,
  en,
};

export function translate(
  localeInput: unknown,
  key: LocaleMessageKey,
  params?: MessageParams,
): string {
  return translateIn(localeResources, localeInput, key, params);
}

export function translateArray(localeInput: unknown, key: LocaleArrayKey): readonly string[] {
  return translateArrayIn(localeResources, localeInput, key);
}

export function createTranslator(localeInput: unknown): {
  locale: SupportedLocale;
  fallback: boolean;
  t: (key: LocaleMessageKey, params?: MessageParams) => string;
  ta: (key: LocaleArrayKey) => readonly string[];
} {
  return createTranslatorIn(localeResources, localeInput);
}

export function resolveMessage(
  localeInput: unknown,
  key: LocaleMessageKey,
  params?: MessageParams,
): ResolvedMessage {
  return resolveMessageIn(localeResources, localeInput, key, params);
}

export function resolveMessageArray(localeInput: unknown, key: LocaleArrayKey): ResolvedMessageArray {
  return resolveMessageArrayIn(localeResources, localeInput, key);
}

export function getLocaleStringKeys(locale: SupportedLocale = DEFAULT_LOCALE): string[] {
  return getLocaleStringKeysIn(localeResources, locale);
}

export function getLocaleArrayKeys(locale: SupportedLocale = DEFAULT_LOCALE): string[] {
  return getLocaleArrayKeysIn(localeResources, locale);
}

export type { LocaleResourceSet };

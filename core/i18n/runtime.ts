import {
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREFERENCES,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type LocaleResourceTree,
  type MessageParams,
  type ResolvedLocale,
  type ResolvedLocaleState,
  type ResolvedMessage,
  type ResolvedMessageArray,
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

/**
 * Resource-free i18n runtime. This module must never import the locale
 * resource trees (./resources/*) so that background bundles can build their
 * own slimmer translator over a section subset without dragging in the full
 * UI message tree.
 */

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return typeof value === 'string' && (LOCALE_PREFERENCES as readonly string[]).includes(value);
}

export function normalizeLocalePreference(value: unknown): LocalePreference {
  return isLocalePreference(value) ? value : DEFAULT_LOCALE_PREFERENCE;
}

export function resolveSupportedLocale(value: unknown): ResolvedLocale {
  if (isSupportedLocale(value)) return { locale: value, fallback: false };
  return { locale: DEFAULT_LOCALE, fallback: true };
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale {
  return resolveSupportedLocale(value).locale;
}

export function resolveLocalePreference(
  preferenceInput: unknown,
  browserLanguages: readonly string[] = getBrowserLanguageCandidates(),
): ResolvedLocaleState {
  const preference = normalizeLocalePreference(preferenceInput);
  if (preference !== 'auto') {
    return {
      preference,
      locale: preference,
      fallback: false,
      browserLanguages: [...browserLanguages],
    };
  }

  for (const language of browserLanguages) {
    const locale = localeFromLanguageTag(language);
    if (locale) {
      return {
        preference,
        locale,
        fallback: false,
        browserLanguages: [...browserLanguages],
      };
    }
  }

  return {
    preference,
    locale: DEFAULT_LOCALE,
    fallback: true,
    browserLanguages: [...browserLanguages],
  };
}

export function getBrowserLanguageCandidates(): string[] {
  const candidates: string[] = [];
  const chromeLanguage = getChromeUiLanguage();
  if (chromeLanguage) candidates.push(chromeLanguage);

  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) {
      candidates.push(...navigator.languages.filter((language): language is string => typeof language === 'string'));
    }
    if (typeof navigator.language === 'string') {
      candidates.push(navigator.language);
    }
  }

  return dedupe(candidates.map((language) => language.trim()).filter(Boolean));
}

function getChromeUiLanguage(): string | null {
  try {
    const i18n = typeof chrome !== 'undefined' ? chrome.i18n : undefined;
    const language = i18n?.getUILanguage?.();
    return typeof language === 'string' && language.trim() ? language : null;
  } catch {
    return null;
  }
}

function localeFromLanguageTag(language: string): SupportedLocale | null {
  const normalized = language.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) return null;
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (
    normalized === 'zh' ||
    normalized.startsWith('zh-') ||
    normalized === 'cn' ||
    normalized.startsWith('cn-')
  ) {
    return 'zh-CN';
  }
  return null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    return String(params[name]);
  });
}

export type LocaleResourceSet = Record<SupportedLocale, LocaleResourceTree>;

export function translateIn(
  resources: LocaleResourceSet,
  localeInput: unknown,
  key: string,
  params?: MessageParams,
): string {
  return resolveMessageIn(resources, localeInput, key, params).value;
}

export function translateArrayIn(
  resources: LocaleResourceSet,
  localeInput: unknown,
  key: string,
): readonly string[] {
  return resolveMessageArrayIn(resources, localeInput, key).value;
}

export function createTranslatorIn(resources: LocaleResourceSet, localeInput: unknown): {
  locale: SupportedLocale;
  fallback: boolean;
  t: (key: string, params?: MessageParams) => string;
  ta: (key: string) => readonly string[];
} {
  const resolved = resolveSupportedLocale(localeInput);
  return {
    ...resolved,
    t: (key, params) => resolveMessageIn(resources, resolved.locale, key, params).value,
    ta: (key) => resolveMessageArrayIn(resources, resolved.locale, key).value,
  };
}

export function resolveMessageIn(
  resources: LocaleResourceSet,
  localeInput: unknown,
  key: string,
  params?: MessageParams,
): ResolvedMessage {
  const locale = resolveSupportedLocale(localeInput);
  const value = readResourcePath(resources[locale.locale], key);
  if (typeof value !== 'string') {
    throw new Error(`Locale key "${key}" is not a string message`);
  }
  return {
    value: formatMessage(value, params),
    locale: locale.locale,
    fallback: locale.fallback,
  };
}

export function resolveMessageArrayIn(
  resources: LocaleResourceSet,
  localeInput: unknown,
  key: string,
): ResolvedMessageArray {
  const locale = resolveSupportedLocale(localeInput);
  const value = readResourcePath(resources[locale.locale], key);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Locale key "${key}" is not a string array message`);
  }
  return {
    value,
    locale: locale.locale,
    fallback: locale.fallback,
  };
}

export function getLocaleStringKeysIn(resources: LocaleResourceSet, locale: SupportedLocale = DEFAULT_LOCALE): string[] {
  return collectLocaleKeys(resources[locale], 'string');
}

export function getLocaleArrayKeysIn(resources: LocaleResourceSet, locale: SupportedLocale = DEFAULT_LOCALE): string[] {
  return collectLocaleKeys(resources[locale], 'array');
}

function readResourcePath(resource: LocaleResourceTree, key: string): unknown {
  let current: unknown = resource;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`Missing locale key "${key}"`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function collectLocaleKeys(resource: unknown, kind: 'string' | 'array', prefix = ''): string[] {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return [];

  const keys: string[] = [];
  const entries = Object.entries(resource as Record<string, unknown>);
  for (const [name, value] of entries) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string') {
      if (kind === 'string') keys.push(path);
      continue;
    }
    if (Array.isArray(value)) {
      if (kind === 'array') keys.push(path);
      continue;
    }
    keys.push(...collectLocaleKeys(value, kind, path));
  }
  return keys;
}

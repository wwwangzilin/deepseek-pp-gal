export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export const LOCALE_PREFERENCES = ['auto', ...SUPPORTED_LOCALES] as const;

export type LocalePreference = typeof LOCALE_PREFERENCES[number];

export const DEFAULT_LOCALE_PREFERENCE: LocalePreference = 'auto';

export type MessageParamValue = string | number | boolean;

export type MessageParams = Record<string, MessageParamValue>;

export type LocaleResourceTree = {
  readonly [key: string]: string | readonly string[] | LocaleResourceTree;
};

export type LocaleSchema<T> =
  T extends string ? string :
  T extends readonly string[] ? readonly string[] :
  T extends object ? { readonly [K in keyof T]: LocaleSchema<T[K]> } :
  never;

export type StringLeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]:
    T[K] extends string
      ? `${Prefix}${K}`
      : T[K] extends readonly string[]
        ? never
        : T[K] extends Record<string, unknown>
          ? StringLeafPaths<T[K], `${Prefix}${K}.`>
          : never;
}[keyof T & string];

export type ArrayLeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]:
    T[K] extends string
      ? never
      : T[K] extends readonly string[]
        ? `${Prefix}${K}`
        : T[K] extends Record<string, unknown>
          ? ArrayLeafPaths<T[K], `${Prefix}${K}.`>
          : never;
}[keyof T & string];

export interface ResolvedLocale {
  locale: SupportedLocale;
  fallback: boolean;
}

export interface ResolvedLocaleState extends ResolvedLocale {
  preference: LocalePreference;
  browserLanguages: readonly string[];
}

export interface ResolvedMessage {
  value: string;
  locale: SupportedLocale;
  fallback: boolean;
}

export interface ResolvedMessageArray {
  value: readonly string[];
  locale: SupportedLocale;
  fallback: boolean;
}

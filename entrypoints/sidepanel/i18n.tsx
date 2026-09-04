import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createTranslator,
  DEFAULT_LOCALE,
  DEFAULT_LOCALE_PREFERENCE,
  resolveLocalePreference,
  type LocaleArrayKey,
  type LocaleMessageKey,
  type LocalePreference,
  type MessageParams,
  type SupportedLocale,
} from '../../core/i18n';
import {
  getLocalePreference,
  saveLocalePreference,
  watchLocalePreference,
} from '../../core/i18n/store';

interface I18nContextValue {
  locale: SupportedLocale;
  preference: LocalePreference;
  fallback: boolean;
  ready: boolean;
  t: (key: LocaleMessageKey, params?: MessageParams) => string;
  ta: (key: LocaleArrayKey) => readonly string[];
  setPreference: (preference: LocalePreference) => Promise<void>;
}

const defaultTranslator = createTranslator(DEFAULT_LOCALE);

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  preference: DEFAULT_LOCALE_PREFERENCE,
  fallback: false,
  ready: false,
  t: defaultTranslator.t,
  ta: defaultTranslator.ta,
  async setPreference() {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(DEFAULT_LOCALE_PREFERENCE);
  const [ready, setReady] = useState(false);

  const resolved = useMemo(
    () => resolveLocalePreference(preference),
    [preference],
  );
  const translator = useMemo(
    () => createTranslator(resolved.locale),
    [resolved.locale],
  );

  useEffect(() => {
    let cancelled = false;
    getLocalePreference()
      .then((nextPreference) => {
        if (!cancelled) setPreferenceState(nextPreference);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const unsubscribe = watchLocalePreference((nextPreference) => {
      setPreferenceState(nextPreference);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setPreference = useCallback(async (nextPreference: LocalePreference) => {
    const normalized = await saveLocalePreference(nextPreference);
    setPreferenceState(normalized);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale: resolved.locale,
    preference,
    fallback: resolved.fallback,
    ready,
    t: translator.t,
    ta: translator.ta,
    setPreference,
  }), [preference, ready, resolved.fallback, resolved.locale, setPreference, translator.t, translator.ta]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

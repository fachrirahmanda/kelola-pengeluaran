import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CURRENCIES, formatDate, formatMoney } from './format';
import { categoryDisplayName, translate, type Lang, type MessageKey } from './i18n';

// Language and currency are per browser for now (localStorage). They are not saved to the account yet.
const LANG_KEY = 'neraca.lang';
const CURRENCY_KEY = 'neraca.currency';
const PALETTE_KEY = 'neraca.palette';

/** Monochrome is the default look. Soft pastel is the colour style from the reference design. */
export type Palette = 'mono' | 'pastel';

interface Prefs {
  lang: Lang;
  setLang: (lang: Lang) => void;
  currency: string;
  setCurrency: (currency: string) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
  /** Translated text. `{name}` placeholders are filled from vars. */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (amount: number) => string;
  date: (isoDate: string) => string;
  categoryName: (name: string) => string;
}

const PrefsContext = createContext<Prefs | null>(null);

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private mode). The choice then lasts for this visit only.
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (readStored(LANG_KEY) === 'id' ? 'id' : 'en'));
  const [currency, setCurrencyState] = useState<string>(() => {
    const stored = readStored(CURRENCY_KEY);
    return stored && (CURRENCIES as readonly string[]).includes(stored) ? stored : 'IDR';
  });

  // Soft pastel is the default. A browser that chose monochrome keeps it.
  const [palette, setPaletteState] = useState<Palette>(() => (readStored(PALETTE_KEY) === 'mono' ? 'mono' : 'pastel'));

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // palette.css reads this attribute, so the colour style applies to the whole page at once.
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  const setPalette = useCallback((next: Palette) => {
    writeStored(PALETTE_KEY, next);
    setPaletteState(next);
  }, []);

  const setLang = useCallback((next: Lang) => {
    writeStored(LANG_KEY, next);
    setLangState(next);
  }, []);

  const setCurrency = useCallback((next: string) => {
    writeStored(CURRENCY_KEY, next);
    setCurrencyState(next);
  }, []);

  const value = useMemo<Prefs>(
    () => ({
      lang,
      setLang,
      currency,
      setCurrency,
      palette,
      setPalette,
      t: (key, vars) => translate(lang, key, vars),
      money: (amount) => formatMoney(amount, currency, lang),
      date: (isoDate) => formatDate(isoDate, lang),
      categoryName: (name) => categoryDisplayName(name, lang),
    }),
    [lang, currency, palette, setLang, setCurrency, setPalette],
  );

  return <PrefsContext value={value}>{children}</PrefsContext>;
}

export function usePrefs(): Prefs {
  const value = useContext(PrefsContext);
  if (!value) throw new Error('usePrefs harus dipakai di dalam PrefsProvider');
  return value;
}

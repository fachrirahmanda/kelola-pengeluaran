import { usePrefs } from '../prefs';

// Theme buttons for Basis. The design system handles the clicks and aria-pressed state.
export function ThemeSwitch() {
  const { t } = usePrefs();
  return (
    <div className="theme-switch" role="group" aria-label={t('nav.menu')}>
      <button type="button" data-theme-value="system" title={t('theme.system')} aria-label={t('theme.system')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      </button>
      <button type="button" data-theme-value="light" title={t('theme.light')} aria-label={t('theme.light')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      </button>
      <button type="button" data-theme-value="dark" title={t('theme.dark')} aria-label={t('theme.dark')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      </button>
    </div>
  );
}

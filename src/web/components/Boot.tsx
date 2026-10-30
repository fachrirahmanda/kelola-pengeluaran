import { usePrefs } from '../prefs';

/** The Neraca bar chart, its bars growing while the app starts or the session is checked. Same drawing as the
 *  preloader in index.html, so the handover from the first paint to React is seamless. */
export function Boot() {
  const { t } = usePrefs();
  return (
    <div className="boot" role="status" aria-label={t('common.loading')}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="boot-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2a2a" />
            <stop offset="1" stopColor="#050505" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#boot-g)" />
        <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#fff" strokeOpacity=".14" />
        <g fill="#fff"><rect className="bar bar-1" x="7" y="17" width="4.5" height="8" rx="1.2"/><rect className="bar bar-2" x="13.75" y="12" width="4.5" height="13" rx="1.2"/><rect className="bar bar-3" x="20.5" y="7" width="4.5" height="18" rx="1.2"/></g><path d="M5.5 25.5h21" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

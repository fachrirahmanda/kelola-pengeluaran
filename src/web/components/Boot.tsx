import { usePrefs } from '../prefs';

/** The Neraca line chart, drawn while the app starts or the session is checked. Same drawing as the preloader
 *  in index.html, and its animation comes from the rules there, so the handover from the first paint to React
 *  is seamless. */
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
        <path className="trend" pathLength={100} d="M6 22.5 L11.5 16.5 L16.5 19.5 L26 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="ripple" cx="26" cy="9" r="2.4" fill="none" stroke="#fff" strokeWidth="1" />
        <circle className="dot" cx="26" cy="9" r="2.4" fill="#fff" />
      </svg>
    </div>
  );
}

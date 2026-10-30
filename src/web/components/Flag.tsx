// Small flags as inline SVG. Emoji flags show as two letters on Windows, so they are drawn here.
// Simplified shapes at 30x20: they read clearly at the size used in menus.

export type FlagCode = 'id' | 'us' | 'gb' | 'eu' | 'sg' | 'my' | 'jp';

const EU_STARS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 12;
  return { x: 15 + 6.2 * Math.cos(angle), y: 10 + 6.2 * Math.sin(angle) };
});

function FlagShapes({ code }: { code: FlagCode }) {
  switch (code) {
    case 'id':
      return (
        <>
          <rect width="30" height="10" fill="#e70011" />
          <rect y="10" width="30" height="10" fill="#fff" />
        </>
      );
    case 'us':
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} y={i * 3.08} width="30" height="1.54" fill="#b22234" />
          ))}
          <rect width="13" height="10.8" fill="#3c3b6e" />
        </>
      );
    case 'gb':
      return (
        <>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
          <path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.6" />
          <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
          <path d="M15 0V20M0 10H30" stroke="#c8102e" strokeWidth="3.6" />
        </>
      );
    case 'eu':
      return (
        <>
          <rect width="30" height="20" fill="#003399" />
          {EU_STARS.map((star, i) => (
            <circle key={i} cx={star.x} cy={star.y} r="0.9" fill="#ffcc00" />
          ))}
        </>
      );
    case 'sg':
      return (
        <>
          <rect width="30" height="10" fill="#ef3340" />
          <rect y="10" width="30" height="10" fill="#fff" />
          <circle cx="7.5" cy="5" r="3.2" fill="#fff" />
          <circle cx="8.6" cy="5" r="2.7" fill="#ef3340" />
          {[11.2, 13.4, 15.6, 17.8, 14.5].map((x, i) => (
            <circle key={i} cx={x} cy={i === 4 ? 2.4 : 3.2 + (i % 2) * 2.6} r="0.7" fill="#fff" />
          ))}
        </>
      );
    case 'my':
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} y={i * (20 / 14)} width="30" height={20 / 14} fill={i % 2 === 0 ? '#cc0001' : '#fff'} />
          ))}
          <rect width="15" height="10.7" fill="#010066" />
          <circle cx="6" cy="5.4" r="3" fill="#fc0" />
          <circle cx="7" cy="5.4" r="2.4" fill="#010066" />
          <circle cx="10.4" cy="5.4" r="1" fill="#fc0" />
        </>
      );
    case 'jp':
      return (
        <>
          <rect width="30" height="20" fill="#fff" />
          <circle cx="15" cy="10" r="6" fill="#bc002d" />
        </>
      );
  }
}

export function Flag({ code, className }: { code: FlagCode; className?: string }) {
  return (
    <svg className={`flag ${className ?? ''}`} width="20" height="14" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <FlagShapes code={code} />
    </svg>
  );
}

/** Flag for each currency and language choice. */
export const CURRENCY_FLAGS: Record<string, FlagCode> = {
  IDR: 'id',
  USD: 'us',
  EUR: 'eu',
  GBP: 'gb',
  SGD: 'sg',
  MYR: 'my',
  JPY: 'jp',
};

export const LANGUAGE_FLAGS: Record<string, FlagCode> = {
  en: 'us',
  id: 'id',
};

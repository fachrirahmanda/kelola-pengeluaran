import { useEffect, useState, type ReactNode } from 'react';

// A donut chart: rounded segments with a gap between them, and the total in the middle. The segments
// grow around the ring when the chart shows and whenever its values change. Segments are drawn with
// stroke-dasharray, so no chart library is needed.

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const RADIUS = 40;
const STROKE = 9;
/** Length of the gap between two segments, measured on the ring (the rounded ends take part of it). */
const GAP = 13;
const DURATION = 700;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Donut({ segments, centerLabel, centerValue, ariaLabel }: { segments: DonutSegment[]; centerLabel: ReactNode; centerValue: ReactNode; ariaLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  // How far the segments have grown, from 0 to 1. Runs again whenever the values change.
  const [progress, setProgress] = useState(0);
  const shape = segments.map((segment) => segment.value).join(',');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return;
    }
    setProgress(0);
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - started) / DURATION, 1);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [shape]);

  let offset = 0;
  return (
    <div className="donut-wrap" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * CIRCUMFERENCE;
              const start = offset + GAP / 2;
              offset += length;
              const dash = Math.max(length * progress - GAP, 0);
              if (dash === 0) return null;
              return (
                <circle
                  key={segment.label}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 50 50)"
                />
              );
            })}
      </svg>
      <div className="donut-center">
        <strong>{centerValue}</strong>
        <span className="text-sm text-muted">{centerLabel}</span>
      </div>
    </div>
  );
}

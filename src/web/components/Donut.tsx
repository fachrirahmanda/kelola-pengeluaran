import type { ReactNode } from 'react';

// A donut chart: one ring split into segments, with a label in the middle. Segments are drawn with
// stroke-dasharray, so no chart library is needed.

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Donut({ segments, centerLabel, centerValue, ariaLabel }: { segments: DonutSegment[]; centerLabel: ReactNode; centerValue: ReactNode; ariaLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <div className="donut-wrap" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--fill)" strokeWidth="14" />
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * CIRCUMFERENCE;
              const element = (
                <circle
                  key={segment.label}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="14"
                  strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += length;
              return element;
            })}
      </svg>
      <div className="donut-center">
        <span className="text-sm text-muted">{centerLabel}</span>
        <strong>{centerValue}</strong>
      </div>
    </div>
  );
}

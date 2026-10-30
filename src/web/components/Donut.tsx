import type { ReactNode } from 'react';

// A donut chart: rounded segments with a gap between them, a ring of small ticks inside, and the total in
// the middle. Segments are drawn with stroke-dasharray, so no chart library is needed.

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const RADIUS = 40;
const STROKE = 9;
/** Length of the gap between two segments, measured on the ring (the rounded ends take part of it). */
const GAP = 13;
const TICKS = 60;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Small radial ticks just inside the ring. */
function ticks() {
  return Array.from({ length: TICKS }, (_, i) => {
    const angle = -Math.PI / 2 + (i / TICKS) * 2 * Math.PI;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    return { x1: 50 + 26 * cos, y1: 50 + 26 * sin, x2: 50 + 30 * cos, y2: 50 + 30 * sin, key: i };
  });
}

const TICK_MARKS = ticks();

export function Donut({ segments, centerLabel, centerValue, ariaLabel }: { segments: DonutSegment[]; centerLabel: ReactNode; centerValue: ReactNode; ariaLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <div className="donut-wrap" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <g className="donut-ticks">
          {TICK_MARKS.map((tick) => (
            <line key={tick.key} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
          ))}
        </g>
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * CIRCUMFERENCE;
              const start = offset + GAP / 2;
              offset += length;
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
                  strokeDasharray={`${Math.max(length - GAP, 0)} ${CIRCUMFERENCE}`}
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

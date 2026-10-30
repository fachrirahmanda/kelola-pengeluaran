import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, ApiRequestError } from '../api';
import { Donut } from '../components/Donut';
import { Icon } from '../components/Icon';
import { MonthPicker } from '../components/MonthPicker';
import { SkeletonRows } from '../components/Skeleton';
import { useCategories } from '../data';
import { monthLabel, todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { addMonths, monthOf } from '../../shared/recurring';

// Reports: pick a period (3, 6 or 12 months, or your own), then see the total, the month-by-month bars,
// the change from month to month, and where the money went by category.

interface ReportMonth {
  month: string;
  total: number;
  count: number;
}

interface ReportCategory {
  categoryId: string;
  total: number;
  count: number;
}

interface Report {
  from: string;
  to: string;
  total: number;
  count: number;
  months: ReportMonth[];
  categories: ReportCategory[];
}

const MAX_MONTHS = 36;
const PRESETS = [3, 6, 12] as const;
type Period = (typeof PRESETS)[number] | 'custom';

export function ReportsPage() {
  const { t, lang, money, categoryName } = usePrefs();
  const { categories } = useCategories();
  const thisMonth = useMemo(() => monthOf(todayInWib()), []);
  const [period, setPeriod] = useState<Period>(6);
  const [from, setFrom] = useState(addMonths(thisMonth, -5));
  const [to, setTo] = useState(thisMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  const rangeMonths = from && to ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5)) - Number(from.slice(5))) + 1 : 0;
  const rangeProblem = !from || !to ? t('reports.pickRange') : rangeMonths < 1 ? t('reports.rangeOrder') : rangeMonths > MAX_MONTHS ? t('reports.rangeMax') : '';

  function choose(next: Period) {
    setPeriod(next);
    if (next !== 'custom') {
      setFrom(addMonths(thisMonth, -(next - 1)));
      setTo(thisMonth);
    }
  }

  useEffect(() => {
    if (rangeProblem) return;
    let ignore = false;
    setError('');
    api
      .get<Report>(`/reports?from=${from}&to=${to}`)
      .then((data) => {
        if (!ignore) setReport(data);
      })
      .catch((requestError: unknown) => {
        if (!ignore) setError(requestError instanceof ApiRequestError ? requestError.message : t('reports.error'));
      });
    return () => {
      ignore = true;
    };
  }, [from, to, rangeProblem]);

  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category])), [categories]);
  const maxMonth = Math.max(1, ...(report?.months.map((entry) => entry.total) ?? [0]));
  const highest = report && report.months.reduce<ReportMonth | null>((best, entry) => (best === null || entry.total > best.total ? entry : best), null);
  const average = report && report.months.length > 0 ? Math.round(report.total / report.months.length) : 0;

  const exportUrl = `/api/reports/export.csv?from=${from}&to=${to}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('reports.title')}</h2>
          <p className="hint">{t('reports.subtitle')}</p>
        </div>
        <a className={`btn btn-sm ${rangeProblem ? 'is-disabled' : ''}`} href={exportUrl} download aria-disabled={!!rangeProblem}>
          <Icon name="download" size={14} />
          {t('reports.export')}
        </a>
      </div>

      <div className="rep-periods" role="tablist" aria-label={t('reports.period')}>
        {PRESETS.map((months) => (
          <button key={months} type="button" role="tab" className="rep-period" aria-selected={period === months} onClick={() => choose(months)}>
            {t('reports.months', { count: months })}
          </button>
        ))}
        <button type="button" role="tab" className="rep-period" aria-selected={period === 'custom'} onClick={() => setPeriod('custom')}>
          {t('reports.custom')}
        </button>
      </div>

      {period === 'custom' && (
        <div className="card rep-custom">
          <label className="field">
            <span className="field-label">{t('reports.from')}</span>
            <MonthPicker value={from || null} onChange={(value) => setFrom(value ?? '')} max={to || undefined} ariaLabel={t('reports.from')} />
          </label>
          <label className="field">
            <span className="field-label">{t('reports.to')}</span>
            <MonthPicker value={to || null} onChange={(value) => setTo(value ?? '')} min={from || undefined} ariaLabel={t('reports.to')} />
          </label>
        </div>
      )}

      {rangeProblem && (
        <p className="text-danger" role="alert">
          {rangeProblem}
        </p>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      {!rangeProblem && report === null && !error && (
        <div className="card">
          <SkeletonRows count={4} />
        </div>
      )}

      {report && !rangeProblem && (
        <>
          <section className="card rep-hero" aria-label={t('reports.total')}>
            <span className="text-sm text-muted">{t('reports.total')}</span>
            <strong className="rep-total">{money(report.total)}</strong>
            <span className="text-sm text-muted">
              {monthLabel(from, lang)} – {monthLabel(to, lang)} · {t('reports.countLine', { count: report.count })}
            </span>
            <div className="rep-kpis">
              <div className="rep-kpi">
                <span className="text-sm text-muted">{t('reports.average')}</span>
                <strong>{money(average)}</strong>
              </div>
              <div className="rep-kpi">
                <span className="text-sm text-muted">{t('reports.highest')}</span>
                <strong>{highest && highest.total > 0 ? money(highest.total) : '—'}</strong>
                {highest && highest.total > 0 && <span className="text-sm text-muted">{monthLabel(highest.month, lang)}</span>}
              </div>
            </div>
          </section>

          {report.total === 0 ? (
            <div className="card">
              <div className="empty">
                <p>{t('reports.empty')}</p>
              </div>
            </div>
          ) : (
            <>
              <section className="card rep-card" aria-labelledby="report-monthly">
                <h3 id="report-monthly" className="rep-card-title">
                  {t('reports.monthly')}
                </h3>
                <div className="rep-bars" role="img" aria-label={t('reports.monthly')}>
                  {report.months.map((entry, index) => (
                    <div key={entry.month} className="rep-bar" title={`${monthLabel(entry.month, lang)}: ${money(entry.total)}`}>
                      <span className="rep-bar-value">{entry.total > 0 ? shortMoney(entry.total) : ''}</span>
                      <span
                        className="rep-bar-fill"
                        style={{
                          height: `${Math.max(entry.total > 0 ? 4 : 0, Math.round((entry.total / maxMonth) * 100))}%`,
                          '--bar-index': index % 6,
                        } as CSSProperties}
                      />
                      <span className="rep-bar-label">{shortMonth(entry.month, lang)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="rep-grid">
                <section className="card rep-card" aria-labelledby="report-categories">
                  <h3 id="report-categories" className="rep-card-title">
                    {t('reports.categories')}
                  </h3>
                  <Donut
                    ariaLabel={t('reports.categories')}
                    centerLabel={t('reports.total')}
                    centerValue={money(report.total)}
                    segments={report.categories.map((row) => ({ label: row.categoryId, value: row.total, color: categoryById.get(row.categoryId)?.color ?? '#6c757d' }))}
                  />
                  <ul className="rep-legend">
                    {report.categories.map((row) => {
                      const category = categoryById.get(row.categoryId);
                      const share = report.total > 0 ? Math.round((row.total / report.total) * 100) : 0;
                      return (
                        <li key={row.categoryId} className="rep-legend-row rep-legend-item" style={{ '--cat-color': category?.color ?? '#6c757d' } as CSSProperties}>
                          <div className="rep-legend-top">
                            <span className="cat-badge" aria-hidden="true">
                              {category?.icon}
                            </span>
                            <span className="grow truncate">{category ? categoryName(category.name) : t('dash.uncategorized')}</span>
                            <span className="amount">{money(row.total)}</span>
                          </div>
                          <div className="bar-track" role="img" aria-label={`${share}%`}>
                            <span className="bar-fill" style={{ width: `${share}%`, background: 'var(--cat-color)' }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className="card rep-card" aria-labelledby="report-compare">
                  <h3 id="report-compare" className="rep-card-title">
                    {t('reports.comparison')}
                  </h3>
                  <ul className="rep-months">
                    {report.months.map((entry, index) => {
                      const previous = index > 0 ? report.months[index - 1].total : null;
                      return (
                        <li key={entry.month} className="rep-month-row">
                          <span className="grow">{monthLabel(entry.month, lang)}</span>
                          <ChangeCell current={entry.total} previous={previous} />
                          <span className="amount">{money(entry.total)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Short money for the bar labels: 1.2M, 850K. Full amounts are in the summary and the list. */
function shortMoney(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(amount);
}

function shortMonth(month: string, lang: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { month: 'short' });
}

/** Change from the previous month, as a chip. Spending going up is a warning, going down a success. */
function ChangeCell({ current, previous }: { current: number; previous: number | null }) {
  const { t } = usePrefs();
  if (previous === null) return <span className="rep-change text-muted">—</span>;
  if (previous === 0) return <span className="rep-change text-muted">{current > 0 ? t('reports.new') : '—'}</span>;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return <span className="rep-change text-muted">0%</span>;
  return <span className={`rep-change ${change > 0 ? 'is-up' : 'is-down'}`}>{change > 0 ? `▲ ${change}%` : `▼ ${Math.abs(change)}%`}</span>;
}

import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { SkeletonRows } from '../components/Skeleton';
import { useBills } from '../data';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { SOURCE_KIND_LABELS, type OpenBill, type PaidBill, type SourceKind } from '../../shared/types';
import { DatePicker } from '../components/DatePicker';

/** "2026-10" -> "October 2026" (or "Oktober 2026"). */
function periodLabel(period: string, lang: string): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { month: 'long', year: 'numeric' });
}

export function BillsPage() {
  const { t, lang, money, date } = usePrefs();
  const { bills, reload } = useBills();
  const [error, setError] = useState('');

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{t('bills.title')}</h2>
          <p className="hint">{t('bills.subtitle')}</p>
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <section className="settings-section" aria-labelledby="bills-open">
        <h3 id="bills-open" className="section-heading">
          {t('bills.open')}
        </h3>

        {bills === null ? (
          <div className="card">
            <SkeletonRows count={2} />
          </div>
        ) : bills.open.length === 0 ? (
          <div className="card">
            <div className="empty">
              <p className="empty-title">{t('bills.none')}</p>
              <p>{t('bills.noneHint')}</p>
            </div>
          </div>
        ) : (
          <div className="bill-grid">
            {bills.open.map((bill) => (
              <OpenBillCard
                key={`${bill.sourceId}-${bill.period}`}
                bill={bill}
                onPaid={() => {
                  window.DS?.toast(t('bills.paidToast'), { variant: 'success' });
                  void reload();
                }}
                onError={setError}
              />
            ))}
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="bills-history">
        <h3 id="bills-history" className="section-heading">
          {t('bills.history')}
        </h3>
        <div className="card">
          {bills === null ? (
            <SkeletonRows count={2} />
          ) : bills.paid.length === 0 ? (
            <div className="empty">
              <p>{t('bills.historyNone')}</p>
            </div>
          ) : (
            bills.paid.map((paid: PaidBill) => (
              <div key={paid.id} className="list-row">
                <div className="source-main">
                  <span className="source-name">{paid.sourceName}</span>
                  <span className="source-meta">
                    {periodLabel(paid.period, lang)} · {t('bills.count', { count: paid.count })} · {t('bills.paidLine', { date: date(paid.paidOn) })}
                  </span>
                </div>
                <span className="amount">{money(paid.total)}</span>
              </div>
            ))
          )}
        </div>
      </section>

    </>
  );
}

function OpenBillCard({ bill, onPaid, onError }: { bill: OpenBill; onPaid: () => void; onError: (message: string) => void }) {
  const { t, lang, money, date } = usePrefs();
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(todayInWib());
  const [saving, setSaving] = useState(false);

  async function handlePay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError('');
    try {
      await api.post('/bills/pay', { sourceId: bill.sourceId, period: bill.period, paidOn });
      setPaying(false);
      onPaid();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('bills.payError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="bill-card">
      <header className="bill-card-head">
        <div>
          <p className="source-meta">{SOURCE_KIND_LABELS[bill.kind as SourceKind] ?? bill.kind}</p>
          <h4 className="bill-card-title">{bill.sourceName}</h4>
        </div>
        <span className="bill-period">{periodLabel(bill.period, lang)}</span>
      </header>

      <p className="bill-total">{money(bill.total)}</p>
      <dl className="bill-meta">
        <div>
          <dt>{t('bills.countLabel')}</dt>
          <dd>{bill.count}</dd>
        </div>
        <div>
          <dt>{t('bills.closesLabel')}</dt>
          <dd>{date(bill.closesOn)}</dd>
        </div>
        <div>
          <dt>{t('bills.dueLabel')}</dt>
          <dd>{date(bill.dueOn)}</dd>
        </div>
      </dl>

      {paying ? (
        <form className="bill-pay-form" onSubmit={(event) => void handlePay(event)}>
          <label className="tx-field">
            <span className="tx-field-label">{t('bills.paidOn')}</span>
            <DatePicker value={paidOn} onChange={(v) => setPaidOn(v ?? todayInWib())} ariaLabel={t('bills.paidOn')} />
          </label>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setPaying(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('form.saving') : t('bills.confirm')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-primary bill-pay-button" onClick={() => setPaying(true)}>
          {t('bills.markPaid')}
        </button>
      )}
    </article>
  );
}

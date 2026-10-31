import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { Dropdown } from '../components/Dropdown';
import { SkeletonRows } from '../components/Skeleton';
import { useBills } from '../data';
import { todayInWib } from '../format';
import { usePrefs } from '../prefs';
import { shiftMonth } from '../../shared/billing';
import { SOURCE_KIND_LABELS, type OpenBill, type PaidBill, type SourceKind } from '../../shared/types';
import { DatePicker } from '../components/DatePicker';
import { DebitSourceField } from '../components/DebitSourceField';

/** "2026-10" -> "October 2026" (or "Oktober 2026"). */
function periodLabel(period: string, lang: string): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { month: 'long', year: 'numeric' });
}

export function BillsPage() {
  const { t, lang, money, date } = usePrefs();
  const { bills, reload } = useBills();
  const [error, setError] = useState('');
  // A card's bills, from its notice or its page: only that card's bills are shown.
  const [params] = useSearchParams();
  const cardId = params.get('source');
  const open = bills?.open.filter((bill) => !cardId || bill.sourceId === cardId) ?? [];
  const cardName = cardId ? bills?.open.find((bill) => bill.sourceId === cardId)?.sourceName : undefined;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{cardName ? t('bills.forCard', { name: cardName }) : t('bills.title')}</h2>
          <p className="hint">{t('bills.subtitle')}</p>
        </div>
        {cardId && (
          <Link to="/bills" className="btn btn-ghost btn-sm">
            {t('bills.allCards')}
          </Link>
        )}
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
        ) : open.length === 0 ? (
          <div className="card">
            <div className="empty">
              <p className="empty-title">{t('bills.none')}</p>
              <p>{t('bills.noneHint')}</p>
            </div>
          </div>
        ) : (
          <div className="bill-grid">
            {open.map((bill) => (
              <OpenBillCard
                key={`${bill.sourceId}-${bill.period}`}
                bill={bill}
                onPaid={() => {
                  window.DS?.toast(t('bills.paidToast'), { variant: 'success' });
                  void reload();
                }}
                onMoved={() => void reload()}
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
                    {paid.paidFromName && ` · ${t('pay.fromLine', { name: paid.paidFromName })}`}
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

function OpenBillCard({ bill, onPaid, onMoved, onError }: { bill: OpenBill; onPaid: () => void; onMoved: () => void; onError: (message: string) => void }) {
  const { t, lang, money, date } = usePrefs();
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(todayInWib());
  const [paidFromId, setPaidFromId] = useState('');
  const [saving, setSaving] = useState(false);

  // The month the bill is due by default, and the month after it: the two the person can choose between.
  const dueMonth = bill.moved ? shiftMonth(bill.payMonth, -1) : bill.payMonth;
  const nextMonth = shiftMonth(dueMonth, 1);

  async function handlePay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError('');
    try {
      await api.post('/bills/pay', { sourceId: bill.sourceId, period: bill.period, paidOn, paidFromId: paidFromId || null });
      setPaying(false);
      onPaid();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('bills.payError'));
    } finally {
      setSaving(false);
    }
  }

  async function changePayMonth(value: string) {
    onError('');
    try {
      await api.put('/bills/plan', { sourceId: bill.sourceId, period: bill.period, later: value === 'next' });
      onMoved();
    } catch (requestError) {
      onError(requestError instanceof ApiRequestError ? requestError.message : t('common.error.network'));
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
          <dt>{t('bills.periodRange')}</dt>
          <dd>
            {date(bill.fromOn)} – {date(bill.closesOn)}
          </dd>
        </div>
        <div>
          <dt>{t('bills.billingDate')}</dt>
          <dd>{date(bill.billingOn)}</dd>
        </div>
        <div>
          <dt>{t('bills.dueLabel')}</dt>
          <dd>{date(bill.dueOn)}</dd>
        </div>
      </dl>

      <div className="tx-field">
        <span className="tx-field-label">{t('bills.payIn')}</span>
        <Dropdown
          value={bill.moved ? 'next' : 'this'}
          options={[
            { value: 'this', label: `${t('bills.payThisMonth')} · ${periodLabel(dueMonth, lang)}` },
            { value: 'next', label: `${t('bills.payNextMonth')} · ${periodLabel(nextMonth, lang)}` },
          ]}
          onChange={(value) => void changePayMonth(value)}
          ariaLabel={t('bills.payIn')}
        />
      </div>

      {paying ? (
        <form className="bill-pay-form" onSubmit={(event) => void handlePay(event)}>
          <label className="tx-field">
            <span className="tx-field-label">{t('bills.paidOn')}</span>
            <DatePicker value={paidOn} onChange={(v) => setPaidOn(v ?? todayInWib())} ariaLabel={t('bills.paidOn')} />
          </label>
          <DebitSourceField value={paidFromId} onChange={setPaidFromId} optional />
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

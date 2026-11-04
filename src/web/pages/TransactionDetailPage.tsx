import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CategoryIcon } from '../components/CategoryIcon';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { Dialog } from '../components/Dialog';
import { SkeletonRows } from '../components/Skeleton';
import { TransactionForm } from '../components/TransactionForm';
import { useCategories, useSources } from '../data';
import type { MessageKey } from '../i18n';
import { usePrefs } from '../prefs';
import { type Method, type Transaction } from '../../shared/types';

// Debit and credit cards are both Cards in the app.
const METHOD_KEYS: Record<Method, MessageKey> = {
  debit: 'method.cards',
  transfer: 'method.transfer',
  credit: 'method.cards',
};

/** One transaction on its own page: the amount, when and what it was for, how it was paid, its receipts, and edit or delete. */
export function TransactionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, money, date, categoryName } = usePrefs();
  const { categories } = useCategories();
  const { sources, holders } = useSources();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ transaction: Transaction }>(`/transactions/${id}`)
      .then((data) => {
        setTransaction(data.transaction);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link to="/transactions" className="text-sm text-muted tx-back">
      ‹ {t('txd.back')}
    </Link>
  );

  if (failed) {
    return (
      <>
        <div className="page-header">
          <div>{back}</div>
        </div>
        <div className="card">
          <div className="empty">
            <p>{t('txd.notFound')}</p>
          </div>
        </div>
      </>
    );
  }
  if (transaction === null) {
    return (
      <div className="card">
        <SkeletonRows count={3} />
      </div>
    );
  }

  const category = categories?.find((item) => item.id === transaction.categoryId);
  const source = sources?.find((item) => item.id === transaction.sourceId);
  const destination = sources?.find((item) => item.id === transaction.toSourceId);
  const isTransfer = transaction.method === 'transfer';
  const rows: { label: string; value: ReactNode }[] = [
    { label: t('tx.col.category'), value: category ? <span className="txd-category"><CategoryIcon icon={category.icon} />{categoryName(category.name)}</span> : '—' },
    { label: t('tx.col.method'), value: t(METHOD_KEYS[transaction.method]) },
    { label: isTransfer ? t('tx.from') : t('tx.source'), value: source?.name ?? '—' },
    ...(isTransfer ? [{ label: t('tx.to'), value: destination?.name ?? '—' }] : []),
    { label: t('tx.col.note'), value: transaction.note || t('txd.noNote') },
  ];

  async function remove() {
    if (!transaction || !window.confirm(t('tx.confirmDelete'))) return;
    setError('');
    try {
      await api.delete(`/transactions/${transaction.id}`);
      window.DS?.toast(t('tx.deleted'));
      navigate('/transactions');
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('tx.deleteError'));
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          {back}
          <h2>{transaction.note || (category ? categoryName(category.name) : '—')}</h2>
          <p className="hint">
            {date(transaction.occurredOn)}
            {transaction.occurredTime && ` ${transaction.occurredTime}`}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <div className="card-body stack">
          <p className="bill-total">{money(transaction.amount)}</p>
          <div>
            {transaction.status === 'posted' ? (
              <span className="badge badge-success">{t('tx.status.posted')}</span>
            ) : (
              <span className="badge badge-warning">{t('tx.status.unpaid')}</span>
            )}
          </div>
          <div className="stack">
            {rows.map((row) => (
              <div key={row.label} className="list-row">
                <span className="text-muted">{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card tx-detail-receipts">
        <div className="card-body">
          <AttachmentsSection transactionId={transaction.id} />
        </div>
      </div>

      <div className="tx-detail-actions">
        <button type="button" className="btn btn-danger-soft" onClick={() => void remove()}>
          {t('tx.delete')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
          {t('tx.edit')}
        </button>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t('tx.editTitle')}>
        {editing && categories && sources && (
          <TransactionForm
            key={transaction.id}
            categories={categories}
            sources={sources}
            holders={holders}
            initial={transaction}
            submitLabel={t('form.saveChanges')}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              window.DS?.toast(t('tx.updated'), { variant: 'success' });
              load();
            }}
          />
        )}
      </Dialog>
    </>
  );
}

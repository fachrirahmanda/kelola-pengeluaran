import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { Icon } from '../components/Icon';
import { formatDate, localeOf } from '../format';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';

// Ask AI: questions about your own spending. The answer comes from a summary of your data on the
// server; the model never sees another person's data. Questions and answers are kept as a history.

interface Exchange {
  id: string;
  question: string;
  /** Empty while the answer is on its way. */
  answer: string;
  /** UTC from the server, "YYYY-MM-DD HH:MM:SS". Empty while the answer is on its way. */
  createdAt: string;
}

const EXAMPLES: MessageKey[] = ['ask.example1', 'ask.example2', 'ask.example3', 'ask.example4'];

/** The server's UTC "YYYY-MM-DD HH:MM:SS" as a Date. */
function dateOf(createdAt: string) {
  return new Date(`${createdAt.replace(' ', 'T')}Z`);
}

/** The local day of a question, YYYY-MM-DD, to group the history by day. */
function dayOf(createdAt: string) {
  const date = createdAt ? dateOf(createdAt) : new Date();
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function AskPage() {
  const { t, lang, currency } = usePrefs();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ items: Exchange[] }>('/ask/history')
      .then((data) => setHistory(data.items))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError('');
    setBusy(true);
    const pending: Exchange = { id: `pending-${Date.now()}`, question: trimmed, answer: '', createdAt: '' };
    setHistory((list) => [...list, pending]);
    setQuestion('');
    try {
      const data = await api.post<{ answer: string; id: string; createdAt: string }>('/ask', { question: trimmed, currency });
      setHistory((list) => list.map((item) => (item.id === pending.id ? { ...pending, ...data } : item)));
    } catch (requestError) {
      setHistory((list) => list.filter((item) => item.id !== pending.id));
      setQuestion(trimmed);
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ask.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm(t('ask.clearConfirm'))) return;
    try {
      await api.delete('/ask/history');
      setHistory([]);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ask.failed'));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  const timeFormat = new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit' });
  const today = dayOf('');

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h2>{t('ask.title')}</h2>
          <p className="hint">{t('ask.intro')}</p>
        </div>
        {history.length > 0 && !busy && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clearHistory()}>
            <Icon name="trash" size={16} />
            {t('ask.clear')}
          </button>
        )}
      </div>

      {loaded && history.length === 0 && (
        <div className="chip-row">
          {EXAMPLES.map((key) => (
            <button key={key} type="button" className="chip" onClick={() => void ask(t(key))}>
              {t(key)}
            </button>
          ))}
        </div>
      )}

      <div className="stack">
        {history.map((item, index) => {
          const day = dayOf(item.createdAt);
          const newDay = index === 0 || dayOf(history[index - 1].createdAt) !== day;
          return (
            <div key={item.id} className="stack">
              {newDay && <p className="ask-day">{day === today ? t('ask.today') : formatDate(day, lang)}</p>}
              <div className="ask-message is-user">
                <p>{item.question}</p>
              </div>
              {item.answer && (
                <div className="ask-message is-ai">
                  <span className="avatar avatar-sm" aria-hidden="true">
                    <Icon name="sparkle" size={14} />
                  </span>
                  <div>
                    <p>{item.answer}</p>
                    {item.createdAt && <time className="ask-time">{timeFormat.format(dateOf(item.createdAt))}</time>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {busy && <p className="hint">{t('ask.thinking')}</p>}
        {error && (
          <div className="alert alert-danger" role="alert">
            <div className="alert-content">
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>

      <form className="ask-form" onSubmit={submit}>
        <input
          className="input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.placeholder')}
          maxLength={1000}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
          <Icon name="send" size={16} />
          {t('ask.send')}
        </button>
      </form>
    </div>
  );
}

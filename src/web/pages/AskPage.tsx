import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, ApiRequestError, postStream } from '../api';
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

/** Between the answers to the questions in one message (PART_BREAK in routes/ask.ts). Each shows as its own reply. */
const PART_BREAK = '\u001e';
/** The composer grows with its text up to this height, then scrolls. */
const COMPOSER_MAX_HEIGHT = 160;

/** What the server sends while it answers (see routes/ask.ts). Other types are ignored. */
type AskEvent =
  | { type: 'thinking' }
  | { type: 'parts'; total: number }
  | { type: 'part'; index: number; total: number; answer: string }
  | { type: 'done'; answer: string; id: string; createdAt: string }
  | { type: 'error'; message: string };

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
  // While an answer is on its way: whether the model is thinking, and seconds since the question was sent.
  const [thinking, setThinking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // For a message with several questions: how many there are, and how many are answered so far.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // While the composer is in use on a phone, the bottom bar is hidden (see .is-typing in styles.css): iOS lifts
  // it above the keyboard, where it covers the conversation.
  const setTyping = (typing: boolean) => {
    document.documentElement.classList.toggle('is-typing', typing);
  };
  useEffect(() => () => setTyping(false), []);

  // The composer grows to show everything typed, up to COMPOSER_MAX_HEIGHT.
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [question]);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

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
    setThinking(false);
    setProgress(null);
    const pending: Exchange = { id: `pending-${Date.now()}`, question: trimmed, answer: '', createdAt: '' };
    setHistory((list) => [...list, pending]);
    setQuestion('');
    const update = (change: (item: Exchange) => Exchange) => setHistory((list) => list.map((item) => (item.id === pending.id ? change(item) : item)));
    try {
      let finished = false;
      const answered: string[] = [];
      await postStream<AskEvent>('/ask', { question: trimmed, currency }, (event) => {
        if (event.type === 'thinking') setThinking(true);
        else if (event.type === 'parts') setProgress({ done: 0, total: event.total });
        else if (event.type === 'part') {
          // Each question's answer shows as soon as it is ready; the next one is still being worked on.
          answered[event.index] = event.answer;
          setProgress({ done: event.index + 1, total: event.total });
          setThinking(false);
          update((item) => ({ ...item, answer: answered.join(PART_BREAK) }));
        } else if (event.type === 'done') {
          finished = true;
          update(() => ({ id: event.id, question: trimmed, answer: event.answer, createdAt: event.createdAt }));
        } else if (event.type === 'error') throw new ApiRequestError(event.message, 502);
      });
      if (!finished) throw new Error('incomplete');
    } catch (requestError) {
      setHistory((list) => list.filter((item) => item.id !== pending.id));
      setQuestion(trimmed);
      // Anything but a message from the server means the connection closed before the answer was complete.
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ask.cutOff'));
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

  // With a keyboard and mouse, Enter sends and Shift+Enter starts a new line. On a phone, Return starts a new
  // line and the button sends.
  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    event.preventDefault();
    void ask(question);
  }

  // While several questions are answered in turn, the status stays until the last one is ready.
  const waiting = busy && (!history[history.length - 1]?.answer || (progress !== null && progress.done < progress.total));
  const status = progress && progress.total > 1 ? t('ask.part', { n: Math.min(progress.done + 1, progress.total), total: progress.total }) : thinking ? t('ask.reasoning') : t('ask.thinking');

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
              {item.answer &&
                item.answer.split(PART_BREAK).map((part, partIndex, all) => (
                  <div key={partIndex} className="ask-message is-ai">
                    <span className="avatar avatar-sm" aria-hidden="true">
                      <Icon name="sparkle" size={14} />
                    </span>
                    <div>
                      <p>{part}</p>
                      {item.createdAt && partIndex === all.length - 1 && <time className="ask-time">{timeFormat.format(dateOf(item.createdAt))}</time>}
                    </div>
                  </div>
                ))}
            </div>
          );
        })}
        {waiting && (
          <p className="hint ask-status" role="status">
            <span className="ask-pulse" aria-hidden="true" />
            {status} · {t('ask.seconds', { n: seconds })}
          </p>
        )}
        {error && (
          <div className="alert alert-danger" role="alert">
            <div className="alert-content">
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>

      <div className="ask-dock">
        <form className="ask-composer" onSubmit={submit}>
          <textarea
            ref={composer}
            className="ask-input"
            rows={1}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onComposerKey}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            placeholder={t('ask.placeholder')}
            aria-label={t('ask.placeholder')}
            maxLength={1000}
            autoComplete="off"
          />
          <button type="submit" className="ask-send" disabled={busy || !question.trim()} aria-label={t('ask.send')} title={t('ask.send')}>
            <Icon name="send" size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

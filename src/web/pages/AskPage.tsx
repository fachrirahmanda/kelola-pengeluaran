import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { PART_BREAK, useAsk } from '../ask';
import { Icon } from '../components/Icon';
import { formatDate, localeOf } from '../format';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';

// Ask AI: questions about your own spending. The answer comes from a summary of your data on the
// server; the model never sees another person's data. Questions and answers are kept as a history. The
// conversation itself lives in ask.tsx, so an answer keeps coming while the person is on another page.

const EXAMPLES: MessageKey[] = ['ask.example1', 'ask.example2', 'ask.example3', 'ask.example4'];

/** The composer grows with its text up to this height, then scrolls. */
const COMPOSER_MAX_HEIGHT = 160;

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
  const { t, lang } = usePrefs();
  const { history, loaded, busy, error, thinking, progress, startedAt, draft: question, setDraft: setQuestion, load, ask, clearHistory } = useAsk();
  const [seconds, setSeconds] = useState(0);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(load, [load]);

  // Opened from a notification (?answer=<id>, or "last"): scroll to that question and its answer and mark it
  // for a moment. The parameter is then dropped, so later updates do not scroll again.
  const [params, setParams] = useSearchParams();
  const target = params.get('answer');
  useEffect(() => {
    if (!target || !loaded || history.length === 0) return;
    const id = target === 'last' ? history[history.length - 1].id : target;
    const element = document.getElementById(`ask-${id}`) ?? document.getElementById(`ask-${history[history.length - 1].id}`);
    setParams({}, { replace: true });
    if (!element) return;
    element.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    for (const marked of document.querySelectorAll('.ask-exchange.is-highlight')) marked.classList.remove('is-highlight');
    element.classList.add('is-highlight');
    window.setTimeout(() => element.classList.remove('is-highlight'), 2000);
  }, [target, loaded, history, setParams]);

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

  // Seconds since the question was sent, also after coming back from another page.
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

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
    <div className="stack-lg ask-page">
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
            <div key={item.id} id={`ask-${item.id}`} className="stack ask-exchange">
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

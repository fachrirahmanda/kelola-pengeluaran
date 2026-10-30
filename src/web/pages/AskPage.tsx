import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { Icon } from '../components/Icon';
import { usePrefs } from '../prefs';
import type { MessageKey } from '../i18n';

// Ask AI: questions about your own spending. The answer comes from a summary of your data on the
// server; the model never sees another person's data.

interface Message {
  role: 'user' | 'ai';
  text: string;
}

const EXAMPLES: MessageKey[] = ['ask.example1', 'ask.example2', 'ask.example3', 'ask.example4'];

export function AskPage() {
  const { t } = usePrefs();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError('');
    setBusy(true);
    setMessages((list) => [...list, { role: 'user', text: trimmed }]);
    setQuestion('');
    try {
      const data = await api.post<{ answer: string }>('/ask', { question: trimmed });
      setMessages((list) => [...list, { role: 'ai', text: data.answer }]);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ask.failed'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h2>{t('ask.title')}</h2>
          <p className="hint">{t('ask.intro')}</p>
        </div>
      </div>

      {messages.length === 0 && (
        <div className="chip-row">
          {EXAMPLES.map((key) => (
            <button key={key} type="button" className="chip" onClick={() => void ask(t(key))}>
              {t(key)}
            </button>
          ))}
        </div>
      )}

      <div className="stack">
        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'ask-message is-user' : 'ask-message is-ai'}>
            {message.role === 'ai' && (
              <span className="avatar avatar-sm" aria-hidden="true">
                <Icon name="sparkle" size={14} />
              </span>
            )}
            <p>{message.text}</p>
          </div>
        ))}
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

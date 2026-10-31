import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api, ApiRequestError, postStream } from './api';
import { usePrefs } from './prefs';

// Ask AI's conversation, kept above the pages: a question keeps being answered while the person moves to
// another page, and the answer is there when they come back. When it is ready the server adds a notification
// (see routes/ask.ts), and the bell is asked to look for it at once.

export interface Exchange {
  id: string;
  question: string;
  /** Empty while the answer is on its way. Several answers are separated by PART_BREAK. */
  answer: string;
  /** UTC from the server, "YYYY-MM-DD HH:MM:SS". Empty while the answer is on its way. */
  createdAt: string;
}

/** Between the answers to the questions in one message (PART_BREAK in routes/ask.ts). Each shows as its own reply. */
export const PART_BREAK = '\u001e';

/** Fired when an answer is ready or has failed, so the notifications look for the server's new one. */
export const NOTIFICATIONS_CHANGED = 'neraca:notifications';

/** What the server sends while it answers (see routes/ask.ts). Other types are ignored. */
type AskEvent =
  | { type: 'thinking' }
  | { type: 'parts'; total: number }
  | { type: 'part'; index: number; total: number; answer: string }
  | { type: 'done'; answer: string; id: string; createdAt: string }
  | { type: 'error'; message: string };

interface AskState {
  history: Exchange[];
  /** Whether the history has been loaded once. */
  loaded: boolean;
  busy: boolean;
  error: string;
  /** Whether the model is thinking (a reasoning model, or a long wait). */
  thinking: boolean;
  /** For a message with several questions: how many there are, and how many are answered so far. */
  progress: { done: number; total: number } | null;
  /** When the question on its way was sent, for the seconds shown while waiting. */
  startedAt: number | null;
  /** The text in the composer, kept here so it is still there after visiting another page. */
  draft: string;
  setDraft: (draft: string) => void;
  /** Loads the history the first time the Ask AI page opens. */
  load: () => void;
  ask: (text: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const AskContext = createContext<AskState | null>(null);

export function AskProvider({ children }: { children: ReactNode }) {
  const { t, currency } = usePrefs();
  const [history, setHistory] = useState<Exchange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const loading = useRef(false);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    api
      .get<{ items: Exchange[] }>('/ask/history')
      // A question sent before the history arrived stays at the end.
      .then((data) => setHistory((list) => [...data.items, ...list.filter((item) => !item.createdAt)]))
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
    setStartedAt(Date.now());
    const pending: Exchange = { id: `pending-${Date.now()}`, question: trimmed, answer: '', createdAt: '' };
    setHistory((list) => [...list, pending]);
    setDraft('');
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
      setDraft(trimmed);
      // Anything but a message from the server means the connection closed before the answer was complete.
      setError(requestError instanceof ApiRequestError ? requestError.message : t('ask.cutOff'));
    } finally {
      setBusy(false);
      setStartedAt(null);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
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

  return (
    <AskContext value={{ history, loaded, busy, error, thinking, progress, startedAt, draft, setDraft, load, ask, clearHistory }}>
      {children}
    </AskContext>
  );
}

export function useAsk(): AskState {
  const value = useContext(AskContext);
  if (!value) throw new Error('useAsk harus dipakai di dalam AskProvider');
  return value;
}

import { useEffect, useRef, useState } from 'react';
import { api, listenDataVersion } from './api';

// Keeps an open page current without the person pressing reload:
// - Data: the server counts every change to the data set (GET /api/sync). When the count moves because of a
//   change made elsewhere (another device, tab or member), the page's content is mounted again so it loads
//   fresh data. The page's own changes come back with the new count and do not trigger it.
// - Code and styling: when a new version of the app is deployed, the page reloads to pick it up.
// Neither happens while someone is typing in a field; it waits until they leave it.

const DATA_EVERY_MS = 15_000;
/** The deploy check reads index.html, so it runs every few data checks only. */
const CODE_EVERY_CHECKS = 4;

/** The built app script in an index.html, e.g. "/assets/index-AbC123.js". Null in development. */
function appScriptOf(html: string) {
  return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

/** True while a field has the focus: refreshing now would lose what is being typed. */
function editing() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return active.matches('input, textarea, select, [contenteditable="true"]');
}

/** A number that goes up whenever the page's content should load again; use it as the key of the routed content. */
export function useLiveRefresh() {
  const [refreshKey, setRefreshKey] = useState(0);
  const known = useRef<number | null>(null);
  const pendingData = useRef(false);
  const pendingReload = useRef(false);

  useEffect(() => {
    const ownScript = appScriptOf(document.documentElement.innerHTML);
    let checks = 0;
    let stopped = false;

    function apply() {
      if (stopped || editing()) return;
      if (pendingReload.current) {
        window.location.reload();
        return;
      }
      if (pendingData.current) {
        pendingData.current = false;
        setRefreshKey((key) => key + 1);
      }
    }

    async function check() {
      if (document.hidden) return;
      try {
        const { version } = await api.get<{ version: number }>('/sync');
        if (known.current !== null && version > known.current) pendingData.current = true;
        known.current = Math.max(known.current ?? 0, version);

        checks += 1;
        if (ownScript && checks % CODE_EVERY_CHECKS === 0) {
          const html = await fetch('/', { cache: 'no-store', credentials: 'same-origin' }).then((response) => response.text());
          const latest = appScriptOf(html);
          if (latest && latest !== ownScript) pendingReload.current = true;
        }
      } catch {
        // Offline or signed out: try again on the next check.
      }
      apply();
    }

    // The page's own change: take its count. If the count jumped by more than one, someone else changed
    // something in between, so load again.
    listenDataVersion((version) => {
      if (known.current !== null && version > known.current + 1) pendingData.current = true;
      known.current = Math.max(known.current ?? 0, version);
    });

    const onVisible = () => {
      if (!document.hidden) {
        checks = CODE_EVERY_CHECKS - 1; // Coming back to the tab also checks for a new version.
        void check();
      }
    };
    const onFocusOut = () => window.setTimeout(apply, 300);

    void check();
    const timer = window.setInterval(() => void check(), DATA_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('focusout', onFocusOut);
      listenDataVersion(null);
    };
  }, []);

  return refreshKey;
}

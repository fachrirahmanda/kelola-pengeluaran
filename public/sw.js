// Service worker: what makes Neraca installable on Android ("Add to Home screen") and lets it open
// full screen, not as a browser tab. It caches nothing: pages come from the network as always, and
// only when that fails (offline) does it answer with a short page saying so. API calls and assets
// are left to the browser.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neraca · Offline</title>
<style>
  :root { color-scheme: light dark; }
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box;
    background: #fafafa; color: #0a0a0a; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #000; color: #f5f5f5; } p { color: #a3a3a3; } }
  h1 { margin: 0 0 6px; font-size: 20px; } p { margin: 0 0 18px; color: #737373; }
  button { padding: 10px 18px; border: 0; border-radius: 999px; background: currentColor; font: inherit; font-weight: 600; cursor: pointer; }
  button span { color: #fafafa; } @media (prefers-color-scheme: dark) { button span { color: #000; } }
</style></head>
<body><main><h1>You're offline</h1><p>Neraca needs a connection. Check your network and try again.</p>
<button type="button" onclick="location.reload()"><span>Try again</span></button></main></body></html>`;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});

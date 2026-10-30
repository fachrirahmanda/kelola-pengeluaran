import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { syncThemeColor } from './themeColor';
import './styles.css';
import './palette.css';

// The service worker makes the app installable and keeps it full screen when opened from the home
// screen. Production only: the dev server reloads too often for one.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

syncThemeColor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

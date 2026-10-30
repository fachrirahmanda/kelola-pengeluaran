import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// One build: the React app (static assets) and the Worker (API and auth) run together, in dev too:
// `npm run dev` runs the Worker and D1 locally, on the same origin as the app.
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { port: 5173 },
  // React and the router in a chunk of their own: they change less often than the app, so browsers
  // keep them cached across deploys, and no single file gets too big.
  environments: {
    client: {
      build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules[\/](react|react-dom|react-router|scheduler)[\/]/ }] } } } },
    },
  },
});

export interface Env {
  DB: D1Database;
  /** OAuth client ID, from wrangler.jsonc `vars`. */
  GOOGLE_CLIENT_ID: string;
  /** Client secret for the code exchange. Set with `wrangler secret put GOOGLE_CLIENT_SECRET` (use .dev.vars locally). */
  GOOGLE_CLIENT_SECRET: string;
  /** Signs the session cookie. Set with `wrangler secret put SESSION_SECRET` (use .dev.vars locally). */
  SESSION_SECRET: string;
  /** Encrypts the secrets kept in the database (the Drive token, the NVIDIA key). Set with `wrangler secret put SETTINGS_KEY`. */
  SETTINGS_KEY?: string;
  /** The admin: the account that connects the app's Google Drive. Set in wrangler.jsonc vars. */
  ADMIN_EMAIL?: string;
  /** NVIDIA API key (nvapi-…) for Ask AI. Set with `wrangler secret put NVIDIA_API_KEY` (use .dev.vars locally). */
  NVIDIA_API_KEY?: string;
  /** NVIDIA model for Ask AI, e.g. meta/llama-3.1-70b-instruct. Set with `wrangler secret put NVIDIA_MODEL` or as a var. */
  NVIDIA_MODEL?: string;
  /** Optional: route the calls through another OpenAI-compatible endpoint. */
  NVIDIA_BASE_URL?: string;
  /** Set to "true" in .dev.vars only. Enables the no-Google dev login on localhost. Never set in production. */
  DEV_LOGIN?: string;
}

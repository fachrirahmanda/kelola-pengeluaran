// Basis design system, loaded at runtime from VITE_DS_URL (see index.html).
// Optional because the app should keep working if the script fails to load.
interface Window {
  DS?: {
    version: string;
    getTheme(): 'light' | 'dark' | 'system';
    setTheme(theme: 'light' | 'dark' | 'system', persist?: boolean): void;
    toast(message: string, options?: {
      variant?: 'info' | 'success' | 'warning' | 'danger';
      duration?: number;
      action?: { label: string; onClick: () => void };
    }): { dismiss(): void };
  };
  google?: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string; error?: string }) => void;
        }): { requestAccessToken(overrides?: { prompt?: string }): void };
      };
    };
  };
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADMIN_EMAILS?: string;
  readonly VITE_VIP_EMAILS?: string;
  readonly VITE_DEMO_ACCOUNT_NAME?: string;
  readonly VITE_REAL_ACCOUNT_NAME?: string;
  readonly VITE_DEMO_ACCOUNT_SHORT?: string;
  readonly VITE_REAL_ACCOUNT_SHORT?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_MARKET_DATA_PROVIDER?: string;
  readonly VITE_DERIV_APP_ID?: string;
  readonly VITE_MARKET_DATA_WS_URL?: string;
  readonly VITE_MARKET_DATA_API_URL?: string;
  readonly VITE_E2E_AUTH_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

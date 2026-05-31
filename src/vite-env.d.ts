/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Firebase Web app config (NOT secret — these ship to the client).
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  // Desktop OAuth (loopback) — only used by the Tauri build. Both come from a
  // Google "Desktop app" OAuth client; the secret is not confidential here.
  readonly VITE_GOOGLE_DESKTOP_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DESKTOP_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

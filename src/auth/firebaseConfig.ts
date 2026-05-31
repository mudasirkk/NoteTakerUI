// Firebase configuration, read from Vite env vars (VITE_FIREBASE_*). When the
// required keys are absent the whole accounts/sync layer no-ops, so the app runs
// exactly as before for anyone who hasn't set up a Firebase project.
//
// These values are NOT secrets — the Firebase web config is meant to ship to the
// client. Access is controlled by Firestore security rules, not by hiding the key.

import type { FirebaseOptions } from "firebase/app";

function readConfig(): FirebaseOptions | null {
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const appId = env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  };
}

export const firebaseConfig: FirebaseOptions | null = readConfig();

export function isFirebaseConfigured(): boolean {
  return firebaseConfig !== null;
}

// Desktop loopback OAuth client id (Tauri build only). Optional until Stage 12d.
export const googleDesktopClientId: string | undefined =
  import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;

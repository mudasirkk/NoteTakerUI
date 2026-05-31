// Lazy Firebase singletons. Returns null when Firebase isn't configured, so every
// caller can degrade gracefully (no accounts, no sync — just the local app).

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cached: FirebaseHandles | null = null;

export function getFirebase(): FirebaseHandles | null {
  if (cached) return cached;
  if (!firebaseConfig) return null;
  // getApp()/getApps() guards against double-init across Vite HMR reloads.
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cached = { app, auth: getAuth(app), db: getFirestore(app) };
  return cached;
}

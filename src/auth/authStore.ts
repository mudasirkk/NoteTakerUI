// Authentication state, kept separate from the note store. On sign-in it starts
// the Firestore sync engine; on sign-out it stops it. Firebase persists the
// session itself (IndexedDB in the browser), so onAuthStateChanged restores the
// user across reloads and re-arms sync automatically.

import { create } from "zustand";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebase } from "./firebase";
import { isFirebaseConfigured } from "./firebaseConfig";
import { signInDesktopGoogle } from "./desktopSignIn";
import { startSync, stopSync } from "../storage/sync";
import { isTauri } from "../platform/window";

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  photo: string | null;
}

type Status = "idle" | "signing-in" | "error";

interface AuthState {
  configured: boolean;
  // The first onAuthStateChanged hasn't fired yet. Firebase restores a persisted
  // session from IndexedDB on launch (offline-capable), so the gate must show a
  // neutral splash while `ready` is false instead of flashing the login screen.
  ready: boolean;
  user: AuthUser | null;
  // This device has completed a sign-in at least once. Kept for messaging (e.g.
  // distinguishing a returning user); no longer gates the local-only option.
  hadSession: boolean;
  // The user chose to use the app WITHOUT an account (local-only storage). Persisted
  // across launches in localStorage; a real sign-in clears it.
  offlineBypass: boolean;
  status: Status;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  useLocally: () => void;
}

function toUser(u: User): AuthUser {
  return { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL };
}

// Tiny device-local marker that *some* account has signed in on this machine. We
// store no tokens here (Firebase owns the durable session in IndexedDB) — only a
// boolean that unlocks the offline fallback on the gate. Cleared on explicit
// sign-out, which is a deliberate "leave this device" action.
const HAD_SESSION_KEY = "notetaker:auth:hadSession";
function loadHadSession(): boolean {
  try {
    return localStorage.getItem(HAD_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
function markHadSession(on: boolean): void {
  try {
    if (on) localStorage.setItem(HAD_SESSION_KEY, "1");
    else localStorage.removeItem(HAD_SESSION_KEY);
  } catch {
    /* storage unavailable — the fallback simply won't be offered */
  }
}

// Device-local marker that the user opted to use the app WITHOUT an account
// (local-only). Persisted so the welcome choice isn't shown on every launch.
const LOCAL_ONLY_KEY = "notetaker:auth:localOnly";
function loadLocalOnly(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}
function markLocalOnly(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOCAL_ONLY_KEY, "1");
    else localStorage.removeItem(LOCAL_ONLY_KEY);
  } catch {
    /* best-effort */
  }
}

// Decode a JWT payload for diagnostics (no verification — just to log which OAuth
// client the Google token was minted for, the usual cause of a rejected sign-in).
function logTokenClaims(idToken: string) {
  try {
    const part = idToken.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    console.info("[auth] Google id_token claims:", {
      aud: json.aud,
      iss: json.iss,
      email: json.email,
      exp: json.exp,
    });
  } catch {
    /* ignore */
  }
}

// Turn raw Firebase/exchange errors into something actionable in the UI.
function explainAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("network-request-failed") || /network|offline|failed to fetch/i.test(msg))
    return "Couldn't reach Google / Firebase. Check your internet connection and try again.";
  if (code.includes("popup-blocked"))
    return "Your browser blocked the sign-in popup. Allow popups for this site, then try again.";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request"))
    return "The sign-in window closed before finishing. Click Sign in to try again.";
  if (code.includes("operation-not-allowed"))
    return "Google sign-in isn't enabled for this Firebase project. Firebase Console → Authentication → Sign-in method → enable Google.";
  if (code.includes("invalid-credential") || /audience|\baud\b|INVALID_IDP_RESPONSE/i.test(msg))
    return (
      "Firebase rejected the Google token. The 'Desktop app' OAuth client must be in the SAME " +
      "Google Cloud project as your Firebase app, and Google sign-in must be enabled. (" + msg + ")"
    );
  if (/token exchange failed/i.test(msg))
    return (
      "Google token exchange failed — check VITE_GOOGLE_DESKTOP_CLIENT_ID and " +
      "VITE_GOOGLE_DESKTOP_CLIENT_SECRET in .env.local match a 'Desktop app' OAuth client. (" + msg + ")"
    );
  return msg;
}

export const useAuth = create<AuthState>((set) => {
  const fb = getFirebase();

  if (fb) {
    onAuthStateChanged(fb.auth, (u) => {
      if (u) {
        markHadSession(true);
        // A real account supersedes the offline / local-only choice the user made.
        markLocalOnly(false);
        set({ user: toUser(u), hadSession: true, offlineBypass: false, ready: true, status: "idle", error: null });
        void startSync(fb.db, u.uid);
      } else {
        stopSync();
        set({ user: null, ready: true });
      }
    });
  }

  return {
    configured: isFirebaseConfigured(),
    // With no Firebase there is no auth to resolve, so the gate (which ignores
    // `ready` in that case) and any reader can treat us as settled immediately.
    ready: !fb,
    user: null,
    hadSession: loadHadSession(),
    offlineBypass: loadLocalOnly(),
    status: "idle",
    error: null,

    signIn: async () => {
      const f = getFirebase();
      if (!f) {
        set({ status: "error", error: "Firebase isn't configured (see .env.example)." });
        return;
      }
      set({ status: "signing-in", error: null });
      try {
        if (isTauri) {
          // Webviews can't use the popup flow, so desktop runs a system-browser
          // loopback OAuth (Rust) and signs in with the returned Google id_token.
          const idToken = await signInDesktopGoogle();
          logTokenClaims(idToken);
          await signInWithCredential(f.auth, GoogleAuthProvider.credential(idToken));
        } else {
          await signInWithPopup(f.auth, new GoogleAuthProvider());
        }
        // onAuthStateChanged flips status back to idle and sets the user.
      } catch (e) {
        console.error("[auth] sign-in failed:", e);
        set({ status: "error", error: explainAuthError(e) });
      }
    },

    signOut: async () => {
      const f = getFirebase();
      if (!f) return;
      try {
        await fbSignOut(f.auth);
        // Explicit sign-out is a deliberate "leave this device": drop the offline
        // fallback so the gate doesn't offer to reopen these local notes.
        markHadSession(false);
        markLocalOnly(false);
        set({ hadSession: false, offlineBypass: false });
      } catch (e) {
        console.warn("sign out failed", e);
      }
    },

    // Local-only choice (welcome screen): use the app without an account, with notes
    // stored on this device. Persisted so a returning local user isn't re-prompted;
    // a later sign-in clears it and migrates local maps into the account (DC-2a).
    useLocally: () => {
      markLocalOnly(true);
      set({ offlineBypass: true, status: "idle", error: null });
    },
  };
});

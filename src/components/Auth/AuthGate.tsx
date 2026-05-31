import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/authStore";
import {
  isTauri,
  winClose,
  winMinimize,
  winToggleMaximize,
  winIsMaximized,
} from "../../platform/window";

// Mandatory login gate (DC-1). It wraps the whole app shell: when Firebase is
// configured, nothing inside renders until the user is signed in (or has chosen
// the offline fallback). When Firebase is NOT configured the build has no auth at
// all, so the gate is a pass-through and the app stays local-only exactly as
// before. This component is the only new auth concept — sign-in itself still goes
// through the existing authStore (browser popup vs. desktop loopback) (DC-1b).

const IconMin = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const IconMax = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const IconRestore = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <rect x="3" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
    <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);
const IconClose = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
    <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);

// The app uses a custom (decorationless) titlebar that normally lives in TopBar,
// but TopBar isn't mounted behind the gate — so the pre-auth screens need their
// own draggable strip and window controls, or the desktop window can't be moved
// or closed from the login screen (a DC-1a lockout in itself).
function GateTitlebar() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void winIsMaximized().then(setMaximized);
  }, []);
  const toggleMax = () => void winToggleMaximize().then(setMaximized);
  return (
    <div className="gatebar" data-tauri-drag-region>
      <span className="gatebar-brand" data-tauri-drag-region>
        NoteTaker
      </span>
      <div className="winctl">
        <button className="wbtn" title="Minimize" aria-label="Minimize" onClick={winMinimize}>
          <IconMin />
        </button>
        <button
          className="wbtn"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={toggleMax}
        >
          {maximized ? <IconRestore /> : <IconMax />}
        </button>
        <button className="wbtn close" title="Close" aria-label="Close" onClick={winClose}>
          <IconClose />
        </button>
      </div>
    </div>
  );
}

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
    <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4" />
    <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853" />
    <path d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" fill="#FBBC05" />
    <path d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335" />
  </svg>
);

export function AuthGate({ children }: { children: ReactNode }) {
  const configured = useAuth((s) => s.configured);
  const ready = useAuth((s) => s.ready);
  const user = useAuth((s) => s.user);
  const offlineBypass = useAuth((s) => s.offlineBypass);
  const hadSession = useAuth((s) => s.hadSession);
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const signIn = useAuth((s) => s.signIn);
  const continueOffline = useAuth((s) => s.continueOffline);

  // Local-only build: no Firebase, no accounts, no gate — run as before.
  if (!configured) return <>{children}</>;

  // Signed in, or the user opted to keep working from a cached session offline.
  if (user || offlineBypass) return <>{children}</>;

  // Restoring a persisted session (Firebase reads IndexedDB on launch). Show a
  // neutral splash so a returning user never sees the login screen flash by.
  if (!ready) {
    return (
      <div className="authgate">
        {isTauri && <GateTitlebar />}
        <div className="authgate-body">
          <div className="authgate-card">
            <span className="authspin" aria-hidden />
            <p className="authgate-resolving">Restoring your session…</p>
          </div>
        </div>
      </div>
    );
  }

  const busy = status === "signing-in";

  return (
    <div className="authgate">
      {isTauri && <GateTitlebar />}
      <div className="authgate-body">
        <div className="authgate-card" role="dialog" aria-label="Sign in">
          <div className="authgate-brand">NoteTaker</div>
          <h1 className="authgate-title">Sign in to your notes</h1>
          <p className="authgate-sub">
            Your maps live in your Google account, synced to every device you sign in on.
          </p>
          <button className="authgate-google" onClick={() => void signIn()} disabled={busy}>
            <GoogleMark />
            {busy ? "Signing in…" : "Sign in with Google"}
          </button>
          {status === "error" && error && (
            <div className="authgate-err" role="alert">
              <p>{error}</p>
              <button className="authgate-retry" onClick={() => void signIn()} disabled={busy}>
                Try again
              </button>
            </div>
          )}
          {hadSession && (
            <button className="authgate-offline" onClick={continueOffline}>
              Continue offline with your local notes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

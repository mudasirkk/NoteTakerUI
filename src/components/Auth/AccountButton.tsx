import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/authStore";

// Sits in the TopBar. Hidden entirely when Firebase isn't configured, so the
// local-only build looks exactly as it did before accounts existed.
export function AccountButton() {
  const configured = useAuth((s) => s.configured);
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const signIn = useAuth((s) => s.signIn);
  const signOut = useAuth((s) => s.signOut);

  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  if (!configured) return null;

  if (!user) {
    return (
      <div className="acct">
        <button
          className="acct-btn"
          onClick={() => void signIn()}
          disabled={status === "signing-in"}
          title={error ?? "Sign in with Google to sync your notes across devices"}
        >
          {status === "signing-in" ? "Signing in…" : "Sign in"}
        </button>
        {status === "error" && error && (
          <div className="acct-err" role="alert">
            <button
              className="acct-err-x"
              title="Dismiss"
              onClick={() => useAuth.setState({ status: "idle", error: null })}
            >
              ×
            </button>
            {error}
          </div>
        )}
      </div>
    );
  }

  const label = user.name ?? user.email ?? "Account";
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct-btn on"
        onClick={() => setMenu((m) => !m)}
        title={user.email ?? "Account"}
      >
        {user.photo ? (
          <img className="acct-av" src={user.photo} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="acct-av init">{initial}</span>
        )}
      </button>
      {menu && (
        <div className="acct-menu">
          <div className="acct-who">
            {user.name && <div className="acct-name">{user.name}</div>}
            <div className="acct-email">{user.email}</div>
          </div>
          <button
            className="acct-signout"
            onClick={() => {
              setMenu(false);
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

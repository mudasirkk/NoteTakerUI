import { useEffect } from "react";
import { useStore } from "../../state/store";

// Transient toast for sync messages (DC-2a's "clear user messaging"): the
// first-sign-in migration count and keep-both conflict notices. The sync engine
// pushes a string into `syncNotice`; we show it, then auto-dismiss. It's
// informational only — no action is required of the user — so it never blocks.
const DISMISS_MS = 7000;

export function SyncNotice() {
  const notice = useStore((s) => s.syncNotice);
  const setSyncNotice = useStore((s) => s.setSyncNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setSyncNotice(null), DISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, setSyncNotice]);

  if (!notice) return null;

  return (
    <div className="syncnotice" role="status" aria-live="polite">
      <span className="syncnotice-dot" aria-hidden />
      <span className="syncnotice-text">{notice}</span>
      <button
        className="syncnotice-x"
        onClick={() => setSyncNotice(null)}
        title="Dismiss"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

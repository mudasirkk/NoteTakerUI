import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useAuth } from "../../auth/authStore";
import { isTauri } from "../../platform/window";

export function StatusBar() {
  const source = useStore((s) => s.map.source);
  const canSeek = useStore((s) => s.controller.canSeek);
  const setSource = useStore((s) => s.setSource);
  const openLocalVideo = useStore((s) => s.openLocalVideo);
  const hasTranscript = useStore((s) => (s.map.transcript?.length ?? 0) > 0);
  const transcriptOpen = useStore((s) => s.transcriptOpen);
  const setTranscriptOpen = useStore((s) => s.setTranscriptOpen);

  // Live save / sync / account state (UI-4).
  const saving = useStore((s) => s.saving);
  const signedIn = useAuth((s) => s.configured && s.user !== null);
  const account = useAuth((s) => s.user?.email ?? s.user?.name ?? null);

  // Always-on-top pin (UX-5).
  const pinned = useStore((s) => s.pinned);
  const togglePin = useStore((s) => s.togglePin);

  const [open, setOpen] = useState(false);
  const [yt, setYt] = useState("");
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const popRef = useRef<HTMLDivElement>(null);

  // Track connectivity so the chip can show "offline" while signed in (edits are
  // still saved locally and the sync layer flushes them on reconnect).
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const type = source?.type ?? "external";
  const label = source?.label || (type === "youtube" ? "YouTube" : type === "localVideo" ? "Local video" : "External");

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const applyYouTube = () => {
    const url = yt.trim();
    if (!url) return;
    setSource({ type: "youtube", url, label: "YouTube" });
    setYt("");
    setOpen(false);
  };

  // Save-state chip: "saving…" while a write is in flight; otherwise it reflects
  // where the note lives — synced to the account, offline (signed in, no net), or
  // saved on this device only.
  let saveTone: "saving" | "offline" | "synced" | "saved";
  let saveText: string;
  let saveTitle: string;
  if (saving) {
    saveTone = "saving";
    saveText = "saving…";
    saveTitle = "Saving your latest edit…";
  } else if (signedIn && !online) {
    saveTone = "offline";
    saveText = "offline";
    saveTitle = "You're offline. Edits are saved on this device and will sync when you reconnect.";
  } else if (signedIn) {
    saveTone = "synced";
    saveText = "synced";
    saveTitle = account ? `Saved and synced to ${account}.` : "Saved and synced to your account.";
  } else {
    saveTone = "saved";
    saveText = "saved";
    saveTitle = "Saved on this device.";
  }

  return (
    <footer className="statusbar">
      <div className="src-wrap" ref={popRef}>
        <button className="src" onClick={() => setOpen((o) => !o)} title="Change source">
          <span className={"src-dot " + type} />
          <span className="src-name">{label}</span>
          <span className="src-caret">▾</span>
        </button>
        {open && (
          <div className="src-pop">
            <button
              className="src-opt"
              onClick={() => {
                setSource({ type: "external", label: "Lecture" });
                setOpen(false);
              }}
            >
              External · session timer
            </button>
            <div className="src-yt">
              <input
                value={yt}
                onChange={(e) => setYt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyYouTube()}
                placeholder="Paste YouTube URL…"
                autoFocus
              />
              <button onClick={applyYouTube}>Load</button>
            </div>
            <button
              className="src-opt"
              onClick={() => {
                void openLocalVideo();
                setOpen(false);
              }}
            >
              Open local video…
            </button>
          </div>
        )}
      </div>

      <button
        className={"cc-btn" + (hasTranscript ? " has" : "") + (transcriptOpen ? " on" : "")}
        onClick={() => setTranscriptOpen(!transcriptOpen)}
        title={hasTranscript ? "Show/hide transcript" : "Import a transcript (.srt/.vtt)"}
      >
        cc{hasTranscript ? "" : " +"}
      </button>

      <span className={"seekflag" + (canSeek ? " on" : "")}>{canSeek ? "seek ●" : "timer"}</span>
      {/* Always-on-top is a native window feature; the browser can't honor it, so the
          pin only appears in the desktop build. */}
      {isTauri && (
        <button
          className={"pinflag" + (pinned ? " on" : "")}
          onClick={togglePin}
          title={pinned ? "Window stays on top — click to unpin" : "Pin window on top"}
          aria-pressed={pinned}
        >
          {pinned ? "📌 pinned" : "pin"}
        </button>
      )}
      <span className={"savestate " + saveTone} title={saveTitle} aria-live="polite">
        <span className="save-dot" />
        {saveText}
      </span>
    </footer>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { cueIndexAt } from "../../transcript/parse";
import { importTranscriptFile } from "../../transcript/import";
import { formatTime } from "../../util/time";

// A floating, bottom-right transcript panel. Lists the imported cues, highlights
// the one playing now (polled from the active controller), seeks the player on
// click, and can spin a cue off into a time-stamped note. Self-contained: when no
// transcript is loaded it shows an import prompt instead.
export function TranscriptDrawer() {
  const open = useStore((s) => s.transcriptOpen);
  const transcript = useStore((s) => s.map.transcript);
  const controller = useStore((s) => s.controller);
  const canSeek = useStore((s) => s.controller.canSeek);
  const setTranscriptOpen = useStore((s) => s.setTranscriptOpen);
  const setTranscript = useStore((s) => s.setTranscript);
  const clearTranscript = useStore((s) => s.clearTranscript);
  const addNoteFromCue = useStore((s) => s.addNoteFromCue);

  const cues = useMemo(() => transcript ?? [], [transcript]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Live "now playing" cue — cheap binary search, polled a few times a second.
  useEffect(() => {
    if (!open || cues.length === 0) return;
    const id = setInterval(() => {
      setActive(cueIndexAt(cues, controller.getCurrentTime()));
    }, 250);
    return () => clearInterval(id);
  }, [open, cues, controller]);

  // Keep the active cue in view while "follow" is on. Manual scrolling (wheel /
  // drag) turns follow off so we never fight the user; the button turns it back on.
  useEffect(() => {
    if (!following || active < 0) return;
    listRef.current?.querySelector(".tx-cue.on")?.scrollIntoView({ block: "nearest" });
  }, [active, following]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return cues
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (ql ? c.text.toLowerCase().includes(ql) : true));
  }, [cues, q]);

  if (!open) return null;

  const runImport = async () => {
    const parsed = await importTranscriptFile();
    if (parsed == null) return; // cancelled
    if (parsed.length === 0) {
      setNote("Couldn't find any captions in that file.");
      return;
    }
    setNote(null);
    setTranscript(parsed);
  };

  return (
    <section
      className="tx-drawer"
      role="region"
      aria-label="Transcript"
      onKeyDown={(e) => {
        if (e.key === "Escape") setTranscriptOpen(false);
      }}
    >
      <header className="tx-head">
        <span className="tx-title">Transcript</span>
        {cues.length > 0 && <span className="tx-count">{cues.length} cues</span>}
        <button
          className={"tx-follow" + (following ? " on" : "")}
          onClick={() => setFollowing((f) => !f)}
          title="Keep the playing cue in view"
        >
          follow
        </button>
        <button className="tx-x" title="Close (Esc)" onClick={() => setTranscriptOpen(false)}>
          ×
        </button>
      </header>

      {cues.length === 0 ? (
        <div className="tx-empty">
          <p>Import a transcript to read along and jump around the recording.</p>
          <button className="tx-import" onClick={() => void runImport()}>
            Import .srt / .vtt…
          </button>
          {note && <p className="tx-err">{note}</p>}
        </div>
      ) : (
        <>
          <div className="tx-tools">
            <input
              className="tx-filter"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter transcript…"
            />
            <button className="tx-tool" title="Replace transcript" onClick={() => void runImport()}>
              import
            </button>
            <button
              className="tx-tool"
              title="Remove transcript from this map"
              onClick={() => clearTranscript()}
            >
              clear
            </button>
          </div>
          {note && <p className="tx-err">{note}</p>}
          <div
            className="tx-list"
            ref={listRef}
            onWheel={() => following && setFollowing(false)}
            onPointerDown={() => following && setFollowing(false)}
          >
            {results.length === 0 && <div className="tx-none">No lines match.</div>}
            {results.map(({ c, i }) => (
              <div key={i} className={"tx-cue" + (i === active ? " on" : "")}>
                <button
                  className={"tx-time" + (canSeek ? " seekable" : "")}
                  title={canSeek ? "Jump here" : "This source can't seek"}
                  onClick={() => canSeek && controller.seekTo(c.start)}
                >
                  {formatTime(c.start)}
                </button>
                <span className="tx-text">{c.text}</span>
                <button
                  className="tx-add"
                  title="Add as a time-stamped note"
                  onClick={() => addNoteFromCue(c)}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

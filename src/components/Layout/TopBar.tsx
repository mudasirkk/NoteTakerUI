import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { formatTime } from "../../util/time";
import {
  winClose,
  winMinimize,
  winToggleMaximize,
  winIsMaximized,
  isTauri,
} from "../../platform/window";
import { AccountButton } from "../Auth/AccountButton";
import { LAYOUTS, LAYOUT_META } from "../../platform/layout";

// Crisp Windows-style control glyphs (SVG so they stay sharp at any DPI).
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

export function TopBar() {
  const title = useStore((s) => s.map.title);
  const view = useStore((s) => s.view);
  const autoStamp = useStore((s) => s.autoStamp);
  const theme = useStore((s) => s.theme);
  const layout = useStore((s) => s.layout);
  // Pause/Resume + Reset only make sense for the live-lecture (external) timer; a
  // media source's chip just mirrors playback position.
  const isExternal = useStore((s) => (s.map.source?.type ?? "external") === "external");
  const sessionPaused = useStore((s) => s.sessionPaused);
  const playerVisible = useStore((s) => s.playerVisible);
  const {
    setTitle,
    setView,
    toggleAutoStamp,
    resetSession,
    pauseSession,
    togglePlayer,
    elapsed,
    setMaps,
    cycleTheme,
    setLayout,
  } = useStore.getState();

  // Layout switcher popover (one of the three switch entry points). Closes on an
  // outside click or Escape; picking a layout applies it and closes.
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layoutOpen) return;
    const onDown = (e: MouseEvent) => {
      if (layoutRef.current && !layoutRef.current.contains(e.target as Node)) setLayoutOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayoutOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [layoutOpen]);

  // Tick to keep the session timer live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  // Track maximize state so the button shows restore vs. maximize.
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void winIsMaximized().then(setMaximized);
  }, []);
  const toggleMax = () => void winToggleMaximize().then(setMaximized);

  return (
    <header className="appbar">
      <div className="bar-top" data-tauri-drag-region>
        <input
          className="title-input"
          value={title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Lecture title"
        />
        <div className="timer-group">
          <span
            className={"timer" + (isExternal && sessionPaused ? " paused" : "")}
            title={isExternal ? "Session elapsed time" : "Playback position"}
          >
            <span className="rec" />
            {formatTime(elapsed())}
          </span>
          {isExternal && (
            <>
              <button
                className="timer-btn"
                onClick={pauseSession}
                title={sessionPaused ? "Resume the timer (Ctrl+Space)" : "Pause the timer (Ctrl+Space)"}
              >
                {sessionPaused ? "▶ Resume" : "❚❚ Pause"}
              </button>
              <button
                className="timer-btn"
                onClick={resetSession}
                title="Reset the session timer to 0:00"
              >
                ↺ Reset
              </button>
            </>
          )}
        </div>
        {isTauri && (
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
        )}
      </div>
      <div className="bar-bottom">
        <div
          className="vtoggle"
          role="tablist"
          aria-label="View"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setView(view === "outline" ? "map" : "outline");
            }
          }}
        >
          <button
            type="button"
            role="tab"
            id="tab-outline"
            aria-controls="view-panel"
            aria-selected={view === "outline"}
            tabIndex={view === "outline" ? 0 : -1}
            className={view === "outline" ? "on" : ""}
            onClick={() => setView("outline")}
          >
            Outline
          </button>
          <button
            type="button"
            role="tab"
            id="tab-map"
            aria-controls="view-panel"
            aria-selected={view === "map"}
            tabIndex={view === "map" ? 0 : -1}
            className={view === "map" ? "on" : ""}
            onClick={() => setView("map")}
          >
            Map
          </button>
        </div>
        <button
          className={"stamp-toggle" + (autoStamp ? " on" : "")}
          onClick={toggleAutoStamp}
          title="Auto-stamp every new note, or stamp manually with Ctrl+T"
        >
          <span className="led" />
          auto-stamp {autoStamp ? "on" : "off"}
        </button>
        <button
          className="maps-btn"
          onClick={() => setMaps(true)}
          title="Switch or create maps (Ctrl+O)"
        >
          ▤ maps
        </button>
        {!isExternal && (
          <button
            className={"player-toggle" + (playerVisible ? " on" : "")}
            onClick={togglePlayer}
            title={playerVisible ? "Hide the player — notes only" : "Show the player"}
            aria-pressed={playerVisible}
          >
            {playerVisible ? "▣ player" : "▢ player"}
          </button>
        )}
        <div className="lay-wrap" ref={layoutRef}>
          <button
            className="lay-btn"
            onClick={() => setLayoutOpen((o) => !o)}
            title="Window layout — cycle with Ctrl+\"
            aria-haspopup="menu"
            aria-expanded={layoutOpen}
          >
            {LAYOUT_META[layout].icon} layout
          </button>
          {layoutOpen && (
            <div className="lay-pop" role="menu" aria-label="Window layout">
              {LAYOUTS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l === layout}
                  className={"lay-opt" + (l === layout ? " on" : "")}
                  title={LAYOUT_META[l].desc}
                  onClick={() => {
                    setLayout(l);
                    setLayoutOpen(false);
                  }}
                >
                  <span className="lay-ic" aria-hidden>
                    {LAYOUT_META[l].icon}
                  </span>
                  <span className="lay-name">{LAYOUT_META[l].label}</span>
                  {l === layout && <span className="lay-key">on</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="theme-btn"
          onClick={cycleTheme}
          title="Theme: cycle system / light / dark"
          aria-label={`Theme: ${theme}. Click to change.`}
        >
          <span className="theme-ic" aria-hidden>
            {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
          </span>
          {theme === "system" ? "auto" : theme}
        </button>
        <AccountButton />
      </div>
    </header>
  );
}

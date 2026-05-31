import { lazy, Suspense, useEffect } from "react";
import { TopBar } from "./components/Layout/TopBar";
import { StatusBar } from "./components/Layout/StatusBar";
import { OutlineView } from "./components/Outline/OutlineView";
import { PlayerPanel } from "./components/Player/PlayerPanel";
import { JumpPalette } from "./components/Palette/JumpPalette";
import { CommandPalette } from "./components/Palette/CommandPalette";
import { MapsSwitcher } from "./components/Palette/MapsSwitcher";
import { TranscriptDrawer } from "./components/Transcript/TranscriptDrawer";
import { HelpOverlay } from "./components/Help/HelpOverlay";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { SyncNotice } from "./components/Sync/SyncNotice";
import { useStore } from "./state/store";
import { useGlobalKeys } from "./keyboard/useKeyboard";
import { FOOTER_HINTS } from "./keyboard/keymap";
import { installExitFlush } from "./platform/lifecycle";

// Lazy so React Flow + dagre (the map renderer's heavy deps) only download when
// the user first switches to the Map view — outline-only sessions never pay for
// them (UI-1).
const MapView = lazy(() =>
  import("./components/Map/MapView").then((m) => ({ default: m.MapView }))
);

export default function App() {
  const view = useStore((s) => s.view);
  const init = useStore((s) => s.init);
  const setHelp = useStore((s) => s.setHelp);
  useGlobalKeys();

  useEffect(() => {
    void init();
  }, [init]);

  // Flush the pending autosave when the app is hidden or closed (FUN-3/UX-3).
  useEffect(() => installExitFlush(), []);

  return (
    <div className="stage">
      <div className="app">
        <TopBar />
        <main
          className="body"
          id="view-panel"
          role="tabpanel"
          aria-labelledby={view === "outline" ? "tab-outline" : "tab-map"}
        >
          {view === "outline" ? (
            <OutlineView />
          ) : (
            <Suspense fallback={<div className="view-loading">Loading map…</div>}>
              <MapView />
            </Suspense>
          )}
        </main>
        <PlayerPanel />
        <StatusBar />
        <footer className="hints">
          {FOOTER_HINTS.map((b) => (
            <span key={b.combo}>
              <b>{b.footerCombo ?? b.combo}</b> {b.short}
            </span>
          ))}
          <button className="hint-help" onClick={() => setHelp(true)} title="Keyboard shortcuts">
            <b>?</b> shortcuts
          </button>
        </footer>
        <JumpPalette />
        <CommandPalette />
        <MapsSwitcher />
        <TranscriptDrawer />
        <HelpOverlay />
        <Onboarding />
        <SyncNotice />
      </div>
    </div>
  );
}

// Make sure the last debounced edit reaches storage when the app goes away.
// Covers the three realistic ways the window leaves before the 400ms autosave
// timer fires: a browser tab close/reload, the window being hidden (the global
// Ctrl+Alt+N toggle or minimize), and the desktop window being closed.

import { flushPendingSave, flushPendingSaveAsync } from "../state/store";
import { isTauri } from "./window";

export function installExitFlush(): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flushPendingSave();
  };
  const onBeforeUnload = () => flushPendingSave();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);

  let disposed = false;
  let unlistenClose: (() => void) | null = null;

  if (isTauri) {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        let closing = false;
        const un = await win.onCloseRequested(async (event) => {
          // First pass: hold the window open, flush, then close for real. The
          // second close() re-enters here with `closing` set, so we fall through
          // and let it proceed.
          if (closing) return;
          closing = true;
          event.preventDefault();
          try {
            await flushPendingSaveAsync();
          } finally {
            await win.close();
          }
        });
        if (disposed) un();
        else unlistenClose = un;
      } catch (e) {
        console.warn("close-flush listener failed", e);
      }
    })();
  }

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (unlistenClose) unlistenClose();
  };
}

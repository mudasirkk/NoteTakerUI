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
          // Hold the close, flush the last edit, then tear the window down with
          // destroy(). A re-entrant close() here is NOT reliably honored by Tauri
          // from inside its own close-requested handler (the window never actually
          // goes away); destroy() closes immediately and skips this event, so it's
          // the correct "async cleanup, then close" primitive. The flush is bounded
          // by a timeout so a stuck save can never trap the user with a dead X.
          if (closing) return;
          closing = true;
          event.preventDefault();
          try {
            await Promise.race([
              flushPendingSaveAsync(),
              new Promise<void>((resolve) => setTimeout(resolve, 1500)),
            ]);
          } catch (e) {
            console.warn("flush on close failed", e);
          } finally {
            await win.destroy();
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

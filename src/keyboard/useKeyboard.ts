import { useEffect } from "react";
import { useStore } from "../state/store";

// Is the event aimed at a text-entry surface? "?" is a literal character there,
// so the shortcuts overlay must not steal it from a note or a search box.
function isTextEntry(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

// Global (document-level) shortcuts. Node-local editing keys (Enter, Tab,
// arrows, Backspace) are handled inside NodeRow where the caret context matters.
export function useGlobalKeys(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const st = useStore.getState();

      // While the shortcuts overlay is up it owns the keyboard (it closes itself
      // on Escape / scrim / ×); swallow every other global shortcut.
      if (st.helpOpen) return;
      // "?" opens the overlay (UI-3). Checked before the mod gate because "?"
      // carries no Ctrl/Cmd, and only when not typing into a note or field.
      if (e.key === "?" && !isTextEntry(e.target)) {
        e.preventDefault();
        st.setHelp(true);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      // Undo / redo (UX-2). Handled first so it works while a media source is
      // active and while a node textarea is focused — those inputs are
      // React-controlled, so the browser's native undo wouldn't apply anyway. We
      // skip it while a palette/search overlay owns the keystroke, where Ctrl+Z
      // means "undo my typing in the search box".
      const overlayOpen = st.commandOpen || st.paletteOpen || st.mapsOpen;
      if (!overlayOpen) {
        const z = e.key.toLowerCase();
        if (z === "z") {
          e.preventDefault();
          e.shiftKey ? st.redo() : st.undo();
          return;
        }
        if (z === "y") {
          e.preventDefault();
          st.redo();
          return;
        }
        // Delete the selected note and its whole subtree (FUN-5). Confirm first
        // when it has children, so a stray combo can't wipe a branch silently.
        if (e.key === "Backspace" && e.shiftKey) {
          e.preventDefault();
          const id = st.selectedId;
          if (id) {
            const hasKids = st.map.nodes.some((n) => n.parentId === id);
            if (!hasKids || window.confirm("Delete this note and all its children?")) {
              st.deleteSubtree(id);
            }
          }
          return;
        }
      }

      const seek = st.controller.canSeek;

      // Player controls — only when a seekable media source is active, so they
      // don't shadow text word-navigation (Ctrl+←/→) during plain note capture.
      if (seek) {
        if (e.code === "Space") {
          e.preventDefault();
          st.playPause();
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          st.skip(-5);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          st.skip(5);
          return;
        }
        if (e.shiftKey && (e.key === "<" || e.key === ">")) {
          e.preventDefault();
          st.stepRate(e.key === ">" ? 1 : -1);
          return;
        }
      }

      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        st.setPalette(true);
      } else if (k === "k") {
        e.preventDefault();
        st.setCommand(true);
      } else if (k === "o") {
        e.preventDefault();
        st.setMaps(true);
      } else if (e.key === "]") {
        e.preventDefault();
        st.zoomIn();
      } else if (e.key === "[") {
        e.preventDefault();
        st.zoomOut();
      } else if (k === "s") {
        e.preventDefault();
        st.save();
      } else if (k === "m") {
        e.preventDefault();
        st.toggleView();
      } else if (e.key === "." && !e.shiftKey) {
        e.preventDefault();
        if (st.selectedId) st.collapse(st.selectedId);
      } else if (e.key === "," && !e.shiftKey) {
        e.preventDefault();
        if (st.selectedId) st.expand(st.selectedId);
      } else if (k === "t") {
        e.preventDefault();
        if (st.selectedId) st.stamp(st.selectedId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

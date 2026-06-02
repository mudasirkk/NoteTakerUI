// Central description of default keybindings — the single on-screen source of
// truth, rendered by BOTH the footer hint strip and the "?" shortcuts overlay
// (UI-3) so the two can never drift apart. Keep this in step with the real
// handlers in useKeyboard.ts and the node-local editing keys in NodeRow.

import { isTauri, isInstalledPWA } from "../platform/window";

export type KeyGroup = "Capture" | "Reorder" | "Navigate" | "Fold" | "Player" | "App";

export interface Binding {
  combo: string;
  action: string;
  group: KeyGroup;
  // A plain browser tab can't intercept a few combos the OS/browser reserve (Ctrl+T
  // above all); such bindings carry a `web` fallback shown only in a normal tab.
  // Desktop AND installed PWAs keep the real combo (see useNativeCombos below).
  web?: string;
  desktopOnly?: boolean; // drop from the web help/footer (e.g. native global shortcuts)
  footer?: boolean; // also surface this binding in the compact footer strip
  footerCombo?: string; // tighter combo text for the footer (defaults to `combo`)
  short?: string; // terse action label for the footer
}

const RAW: Binding[] = [
  { combo: "Enter", action: "New sibling below", group: "Capture", footer: true, short: "new" },
  { combo: "Tab / ⇧Tab", action: "Indent / outdent", group: "Capture", footer: true, footerCombo: "Tab", short: "indent" },
  { combo: "⇧Enter", action: "Soft line break", group: "Capture" },
  { combo: "⌫", action: "Delete empty node", group: "Capture" },
  { combo: "Ctrl+⇧⌫", action: "Delete note & children", group: "Capture" },
  { combo: "Ctrl+T", web: "Alt+T", action: "Insert / refresh timestamp", group: "Capture" },
  { combo: "Ctrl+Z", action: "Undo", group: "Capture" },
  { combo: "Ctrl+⇧Z", action: "Redo", group: "Capture" },
  { combo: "Ctrl+↑ / Ctrl+↓", action: "Move among siblings", group: "Reorder", footer: true, footerCombo: "Ctrl+↑↓", short: "move" },
  { combo: "↑ / ↓", action: "Move focus between notes", group: "Navigate" },
  { combo: "Ctrl+P", action: "Jump palette", group: "Navigate", footer: true, short: "jump" },
  { combo: "Ctrl+K", action: "Command palette", group: "Navigate", footer: true, short: "cmds" },
  { combo: "Ctrl+O", action: "Switch maps", group: "Navigate", footer: true, short: "maps" },
  { combo: "Ctrl+] / Ctrl+[", action: "Zoom into note / out", group: "Navigate" },
  { combo: "Ctrl+.", action: "Collapse subtree", group: "Fold" },
  { combo: "Ctrl+,", action: "Expand subtree", group: "Fold" },
  { combo: "Ctrl+Space", action: "Play / pause · pause live timer", group: "Player" },
  { combo: "Ctrl+← / Ctrl+→", action: "Rewind / forward", group: "Player" },
  { combo: "Ctrl+⇧< / Ctrl+⇧>", action: "Slower / faster", group: "Player" },
  { combo: "Ctrl+M", action: "Outline / Map", group: "App", footer: true, short: "map" },
  { combo: "Ctrl+\\ / Ctrl+⇧\\", action: "Cycle layout / reverse", group: "App" },
  { combo: "Ctrl+S", action: "Save", group: "App" },
  { combo: "?", action: "Keyboard shortcuts", group: "App" },
  { combo: "Ctrl+Alt+N", action: "Show / hide window", group: "App", desktopOnly: true },
];

// Desktop (Tauri) and installed PWAs (standalone, no tab strip) both receive the
// browser-reserved combos, so they keep the real bindings; only a plain browser tab
// falls back to the `web` override. The keydown handlers fire on both combos either
// way (see useKeyboard.ts) — this just keeps the on-screen help honest.
const useNativeCombos = isTauri || isInstalledPWA;

// Resolve bindings for the current platform once at load (constant per session):
// drop desktop-only entries off Tauri and swap in `web` fallbacks only in a tab.
export const KEYMAP: Binding[] = RAW.filter((b) => isTauri || !b.desktopOnly).map((b) =>
  !useNativeCombos && b.web ? { ...b, combo: b.web } : b
);

// The timestamp shortcut the UI should advertise, reused by the command palette so
// its hint matches the footer/overlay across desktop, installed PWA and plain tab.
export const STAMP_COMBO = useNativeCombos ? "Ctrl+T" : "Alt+T";

// Heading order for the overlay, plus an optional caveat shown beside a heading.
export const GROUP_ORDER: KeyGroup[] = ["Capture", "Reorder", "Navigate", "Fold", "Player", "App"];
export const GROUP_NOTES: Partial<Record<KeyGroup, string>> = {
  Player: "with a seekable video",
};

// The footer shows only the bindings flagged for it, in map order.
export const FOOTER_HINTS: Binding[] = KEYMAP.filter((b) => b.footer);

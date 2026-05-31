// Thin wrapper over Tauri window controls. All calls no-op in a plain browser
// (Phase 1 dev), so the same UI works in both environments.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Win = {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
  hide: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
};

let cached: unknown = null;
async function currentWindow(): Promise<Win> {
  if (cached) return cached as Win;
  const mod = await import("@tauri-apps/api/window");
  cached = mod.getCurrentWindow();
  return cached as Win;
}

export async function winClose() {
  if (!isTauri) return;
  await (await currentWindow()).close();
}
export async function winMinimize() {
  if (!isTauri) return;
  await (await currentWindow()).minimize();
}
export async function winHide() {
  if (!isTauri) return;
  await (await currentWindow()).hide();
}

// Toggle maximize/restore; returns the new maximized state so the UI can swap
// the button icon. No-op (returns false) in a plain browser.
export async function winToggleMaximize(): Promise<boolean> {
  if (!isTauri) return false;
  const w = await currentWindow();
  await w.toggleMaximize();
  return await w.isMaximized();
}
export async function winIsMaximized(): Promise<boolean> {
  if (!isTauri) return false;
  return await (await currentWindow()).isMaximized();
}

// Pin/unpin the always-on-top overlay (UX-5). The ACL already grants
// core:window:allow-set-always-on-top. No-op in a plain browser.
export async function winSetAlwaysOnTop(on: boolean): Promise<void> {
  if (!isTauri) return;
  await (await currentWindow()).setAlwaysOnTop(on);
}

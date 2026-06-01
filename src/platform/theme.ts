// Theme preference (UI-5). Obsidian dark is the v2 signature and the default (the
// :root tokens). Setting data-theme="light" switches to Daylight; data-theme="dark"
// pins Obsidian even under a light OS; "system" removes the attribute and lets the
// prefers-color-scheme media query decide. Per the locked v2 decision the app ships
// dark, so a first launch defaults to "dark" rather than following the OS. Applied
// once in main.tsx before first paint (no flash) and again whenever the user changes it.
import { loadPref, savePref } from "./uiPrefs";

export type ThemePref = "system" | "light" | "dark";

const KEY = "theme";

export function loadTheme(): ThemePref {
  const v = loadPref<ThemePref>(KEY, "dark");
  return v === "light" || v === "system" ? v : "dark";
}

export function saveTheme(pref: ThemePref): void {
  savePref(KEY, pref);
}

export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

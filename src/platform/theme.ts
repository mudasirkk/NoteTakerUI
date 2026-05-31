// Theme preference (UI-5). Light is the CSS default (the :root tokens); choosing
// "dark" or "light" sets a data-theme attribute on <html> that the dark token
// block keys off, while "system" removes it and lets the prefers-color-scheme
// media query decide. Applied once in main.tsx before first paint (no flash) and
// again whenever the user changes it.
import { loadPref, savePref } from "./uiPrefs";

export type ThemePref = "system" | "light" | "dark";

const KEY = "theme";

export function loadTheme(): ThemePref {
  const v = loadPref<ThemePref>(KEY, "system");
  return v === "light" || v === "dark" ? v : "system";
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

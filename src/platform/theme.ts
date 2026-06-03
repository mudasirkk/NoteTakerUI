// Theme preference (UI-5). Three modes: "system" follows the OS via the
// prefers-color-scheme media query (applyTheme removes data-theme so the query
// decides); "light" forces Daylight; "dark" pins Obsidian even under a light OS.
// First launch defaults to "system" (auto) so the app matches the user's OS out of
// the box — picking light or dark from the toggle/palette pins it. Applied once in
// main.tsx before first paint (no flash) and again whenever the user changes it.
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

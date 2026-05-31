// Device-local UI preferences: small presentation niceties (player split height,
// panel collapse, and later the pin/theme toggles) that belong to *this* install,
// not to the synced note data. They live in localStorage — which the Tauri webview
// persists too — and every accessor is a safe no-op if storage is unavailable.
const PREFIX = "notetaker:pref:";

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — preferences are best-effort */
  }
}

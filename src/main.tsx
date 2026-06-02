import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/Auth/AuthGate";
import "./styles.css";
import { applyTheme, loadTheme } from "./platform/theme";
import { isTauri } from "./platform/window";

// Apply the saved theme synchronously, before the first React paint, so a dark
// preference never flashes light on launch (UI-5).
applyTheme(loadTheme());

// Tag the platform so CSS can branch (responsive web rules, edge-to-edge desktop).
// The desktop (frameless Tauri) build fills the window edge-to-edge; in the browser
// the app floats as a card inside a padded backdrop. On the frameless window that
// inset is a dead, non-draggable margin that makes the window look bigger than the
// app, so we drop it there. Set before first paint to avoid a layout flash.
document.documentElement.setAttribute("data-platform", isTauri ? "desktop" : "web");

// Register the offline-shell service worker for the hosted web build only — never in
// dev (HMR would fight the cache) and never in the Tauri desktop shell. Offline
// support is a progressive enhancement, so a failed registration is non-fatal.
if (!isTauri && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// The gate wraps the whole app shell (DC-1): when Firebase is configured nothing
// inside <App> mounts until the user is signed in (so init/autosave only run for
// an authenticated session); when it isn't, the gate is a transparent pass-through
// and the local-only app renders immediately.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);

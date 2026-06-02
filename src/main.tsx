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

// Mark the desktop (frameless Tauri) build so the app fills the window edge-to-edge.
// In the browser the app floats as a card inside a padded backdrop; on the frameless
// window that inset is a dead, non-draggable margin that makes the window look bigger
// than the app. Filling the window removes that confusion. Set before first paint.
if (isTauri) document.documentElement.setAttribute("data-platform", "desktop");

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

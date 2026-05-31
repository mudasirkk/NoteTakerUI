// File-picking that works in both the Tauri desktop shell and a plain browser.
//
// In Tauri we get a real filesystem path (persistable across sessions) and load
// the video through the asset:// protocol via convertFileSrc. In the browser we
// fall back to an <input type="file"> object URL, which is transient — the path
// is unknowable to web pages, so it cannot be persisted.

import { isTauri } from "./window";

export interface PickedVideo {
  path?: string; // real filesystem path — only present (and persistable) under Tauri
  url: string; // URL the <video> element can load (asset:// or blob:)
  label: string; // display name (file basename)
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// Ask the Rust side to add this single path to the asset-protocol allowlist.
// Must complete before the <video> requests the asset:// URL, or the webview
// (whose static asset scope is empty) will refuse to serve the file.
async function grantAssetAccess(filePath: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("allow_video_path", { path: filePath });
  } catch (e) {
    console.warn("Could not grant asset access for", filePath, e);
  }
}

const VIDEO_EXTS = ["mp4", "m4v", "mkv", "webm", "mov", "avi", "ogv", "ogg"];

export async function pickVideoFile(): Promise<PickedVideo | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTS }],
    });
    if (typeof selected !== "string") return null; // cancelled
    await grantAssetAccess(selected);
    return { path: selected, url: convertFileSrc(selected), label: basename(selected) };
  }

  // Browser fallback. The input is clicked synchronously so the call still counts
  // as a user gesture; there is no native "cancel" event, so a dismissed dialog
  // simply leaves the promise unresolved (the detached input is GC'd).
  return new Promise<PickedVideo | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? { url: URL.createObjectURL(f), label: f.name } : null);
    };
    input.click();
  });
}

// Rebuild a loadable URL from a persisted file path. Only possible under Tauri;
// the browser cannot reopen a file by path, so a re-pick is required there.
export async function resolveVideoUrl(filePath: string): Promise<string | null> {
  if (!isTauri) return null;
  await grantAssetAccess(filePath);
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(filePath);
}

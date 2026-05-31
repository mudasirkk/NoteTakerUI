// DC-3: bridge to the Rust YouTube downloader. When a video refuses to embed, the
// shell downloads it into a device-local cache and we play it as a seekable local
// file instead of degrading to the timer. The note map only ever stores the URL
// (DC-3c) — these helpers return a loadable asset:// URL for *this* device's cached
// copy, which is transient and re-fetched on demand per device.
//
// Everything here no-ops in a plain browser (returns null): there's no native
// downloader and no asset protocol, so embed-blocked videos keep their existing
// behaviour there.

import { isTauri } from "./window";

// Download (or reuse the cached copy of) a YouTube video, returning an asset:// URL
// the <video> element can play. Throws on a real failure (missing yt-dlp, network,
// a non-YouTube URL) so the caller can surface it; returns null only when there's
// no native shell to run the download.
export async function downloadYouTube(url: string): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  const path = await invoke<string>("download_youtube", { url });
  return convertFileSrc(path);
}

// Return the asset:// URL for an already-downloaded copy of this URL on this device,
// or null if it isn't cached (or we're in the browser). Never triggers a download,
// so it's cheap to call on map open to light up local playback immediately.
export async function cachedYouTube(url: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("youtube_cached_path", { url });
    return path ? convertFileSrc(path) : null;
  } catch {
    return null; // not a YouTube URL / cache unreadable — just fall back to the embed
  }
}

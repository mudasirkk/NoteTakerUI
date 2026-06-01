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
// Pass force=true to discard any cached copy and re-fetch (e.g. after importing
// cookies or installing ffmpeg, so the new, higher-quality formats are used).
export async function downloadYouTube(url: string, force = false): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  const path = await invoke<string>("download_youtube", { url, force });
  return convertFileSrc(path);
}

// Whether ffmpeg is available to the shell. High-quality (>720p) downloads need it
// to merge YouTube's separate video+audio streams; the UI checks this before a
// download to decide whether to offer the (consent-gated) install. Always false in
// the browser, which has no shell — so the ffmpeg prompt never shows there.
export async function ffmpegAvailable(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("ffmpeg_available");
  } catch {
    return false;
  }
}

// Download + install ffmpeg into the app's data dir, on the user's explicit
// acceptance. Idempotent in the shell (a no-op if ffmpeg is already present).
// Throws on failure so the caller can surface it; the call is only ever made from
// the desktop build (guarded by ffmpegAvailable returning false under Tauri).
export async function installFfmpeg(): Promise<void> {
  if (!isTauri) throw new Error("ffmpeg install is only available in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("download_ffmpeg");
}

// Whether a cookies.txt has been imported for yt-dlp. Cookies let the downloader
// reach signed-in / higher-quality formats YouTube gates behind an account. Always
// false in the browser (no shell to store or use a cookies file).
export async function youtubeCookiesConfigured(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("youtube_cookies_status");
  } catch {
    return false;
  }
}

// Open a native picker for the user's exported cookies.txt and copy it into the
// app's data dir for future downloads. Returns true if a file was imported, false
// if the user cancelled (or we're in the browser). The picker is opened in Rust so
// the webview never handles the path; the file's contents are never logged.
export async function setYouTubeCookiesFile(): Promise<boolean> {
  if (!isTauri) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("set_youtube_cookies");
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

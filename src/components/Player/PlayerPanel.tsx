import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../../state/store";
import { loadPref, savePref } from "../../platform/uiPrefs";
import { isTauri } from "../../platform/window";
import { YouTubePlayer } from "./YouTubePlayer";
import { LocalVideoPlayer } from "./LocalVideoPlayer";

// Keep a restored height sane if the window is smaller than it was last session.
const clampH = (h: number) =>
  Math.min(Math.max(h, 120), Math.round(window.innerHeight * 0.7));

// Embedded player for media sources. Hidden for external sources (timer only).
export function PlayerPanel() {
  const source = useStore((s) => s.map.source);
  const localUrl = useStore((s) => s.localVideoUrl);
  const openLocalVideo = useStore((s) => s.openLocalVideo);
  // DC-3: a device-local downloaded copy of the YouTube source (and its progress),
  // used to swap an embed-blocked iframe for a seekable local <video>.
  const ytLocalUrl = useStore((s) => s.ytLocalUrl);
  const ytStatus = useStore((s) => s.ytStatus);
  const ytError = useStore((s) => s.ytError);
  const downloadActiveYouTube = useStore((s) => s.downloadActiveYouTube);
  // Collapse state and the divider height persist across sessions (UX-7): both
  // are device-local view preferences, so they ride in localStorage, not the map.
  const [collapsed, setCollapsed] = useState(() => loadPref("playerCollapsed", false));
  // Player body height, drag-adjustable via the divider. The notes area (flex:1)
  // absorbs the rest, so dragging trades space between the two.
  const [bodyH, setBodyH] = useState(() => clampH(loadPref("playerHeight", 220)));

  const type = source?.type ?? "external";
  if (type === "external") return null;

  const label = source?.label || (type === "youtube" ? "YouTube" : "Local video");

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      savePref("playerCollapsed", next);
      return next;
    });

  // Drag the divider: pointer capture keeps tracking even over the video iframe.
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const start = bodyH;
    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = clampH(start - (ev.clientY - startY));
      setBodyH(latest);
    };
    const up = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      savePref("playerHeight", latest); // persist only on release, not every frame
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <section className="player">
      {!collapsed && (
        <div className="player-resize" onPointerDown={onResizeDown} title="Drag to resize the player" />
      )}
      <div className="player-head">
        <button
          className="player-fold"
          onClick={toggleCollapsed}
          title={collapsed ? "Show player" : "Hide player"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="player-label" title={label}>
          {label}
        </span>
        {type === "localVideo" && (
          <button className="player-replace" onClick={() => void openLocalVideo()}>
            change file
          </button>
        )}
      </div>

      {!collapsed && (
        <div className={"player-body " + type} style={{ height: bodyH }}>
          {type === "youtube" &&
            // A downloaded copy wins: it plays as a seekable local file (DC-3).
            // Otherwise embed normally; YouTubePlayer triggers a download if the
            // owner blocked embedding.
            (ytLocalUrl ? (
              <LocalVideoPlayer src={ytLocalUrl} />
            ) : source?.url ? (
              <YouTubePlayer url={source.url} />
            ) : (
              <div className="player-warn">No YouTube URL set.</div>
            ))}
          {type === "localVideo" &&
            (localUrl ? (
              <LocalVideoPlayer src={localUrl} />
            ) : (
              <button className="player-pick" onClick={() => void openLocalVideo()}>
                Choose a video file…
              </button>
            ))}
        </div>
      )}

      {/* DC-3 status strip: only meaningful on the desktop build (the browser has no
          native downloader). Shows the local-copy note, download progress, an error
          with retry, or an opt-in download button for embeddable videos. */}
      {!collapsed && isTauri && type === "youtube" && source?.url && (
        <div className="player-ytbar">
          {ytLocalUrl ? (
            <span className="player-ytnote">Playing a downloaded copy — click-to-seek enabled.</span>
          ) : ytStatus === "downloading" ? (
            <span className="player-ytnote downloading">
              <span className="ytspin" aria-hidden /> Downloading for seekable offline playback…
            </span>
          ) : ytStatus === "error" ? (
            <span className="player-ytnote error">
              <span>Download failed{ytError ? `: ${ytError}` : "."}</span>
              <button className="player-ytbtn" onClick={() => void downloadActiveYouTube()}>
                Try again
              </button>
            </span>
          ) : (
            <button
              className="player-ytbtn"
              onClick={() => void downloadActiveYouTube()}
              title="Download this video so click-to-seek works even when embedding is blocked"
            >
              Download for click-to-seek
            </button>
          )}
        </div>
      )}
    </section>
  );
}

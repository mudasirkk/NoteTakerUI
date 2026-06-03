import { useState, useEffect } from "react";
import { useStore } from "../../state/store";
import { isTauri } from "../../platform/window";
import { setYouTubeCookiesFile, youtubeCookiesConfigured } from "../../platform/youtubeDownload";
import { YouTubePlayer } from "./YouTubePlayer";
import { LocalVideoPlayer } from "./LocalVideoPlayer";

// Embedded player for media sources. Hidden for external sources (timer only).
// Sizing/placement is owned by LayoutShell now — this panel simply fills the pane
// it is handed (a docked .mw-video or a floating .mw-pip), so it carries no
// collapse/resize state of its own anymore.
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
  const installFfmpegThenDownload = useStore((s) => s.installFfmpegThenDownload);
  const skipFfmpegAndDownload = useStore((s) => s.skipFfmpegAndDownload);

  // Whether a cookies.txt is imported (desktop only) — lets yt-dlp reach signed-in /
  // higher-quality formats. Loaded once; reflected on the import button's label.
  const [hasCookies, setHasCookies] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    void youtubeCookiesConfigured().then((v) => {
      if (alive) setHasCookies(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const importCookies = async () => {
    const ok = await setYouTubeCookiesFile();
    if (ok) setHasCookies(true);
  };

  // Web only: YouTubePlayer reports here when the owner has disabled embedding. A
  // browser can't fetch a seekable copy (no native yt-dlp), so we surface a short
  // explanatory note rather than failing silently. Reset whenever the source changes.
  const [embedBlocked, setEmbedBlocked] = useState(false);
  useEffect(() => {
    setEmbedBlocked(false);
  }, [source?.url]);

  const type = source?.type ?? "external";
  if (type === "external") return null;

  const label = source?.label || (type === "youtube" ? "YouTube" : "Local video");

  return (
    <section className="player">
      <div className="player-head">
        <span className="player-label" title={label}>
          {label}
        </span>
        {type === "localVideo" && (
          <button className="player-replace" onClick={() => void openLocalVideo()}>
            change file
          </button>
        )}
      </div>

      <div className={"player-body " + type}>
        {type === "youtube" &&
          // A downloaded copy wins: it plays as a seekable local file (DC-3).
          // Otherwise embed normally; YouTubePlayer triggers a download if the
          // owner blocked embedding.
          (ytLocalUrl ? (
            <LocalVideoPlayer src={ytLocalUrl} />
          ) : source?.url ? (
            <YouTubePlayer url={source.url} onEmbedBlocked={() => setEmbedBlocked(true)} />
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

      {/* DC-3 status strip: only meaningful on the desktop build (the browser has no
          native downloader). Shows the local-copy note, download progress, an error
          with retry, or an opt-in download button for embeddable videos. */}
      {isTauri && type === "youtube" && source?.url && (
        <div className="player-ytbar">
          {ytStatus === "installing-ffmpeg" ? (
            <span className="player-ytnote downloading">
              <span className="ytspin" aria-hidden /> Installing ffmpeg for high-quality video…
            </span>
          ) : ytStatus === "downloading" ? (
            <span className="player-ytnote downloading">
              <span className="ytspin" aria-hidden /> Downloading for seekable offline playback…
            </span>
          ) : ytStatus === "needs-ffmpeg" ? (
            <span className="player-ytnote prompt">
              <span>High-quality (1080p) downloads need ffmpeg (~110&nbsp;MB). Install it now?</span>
              <button className="player-ytbtn" onClick={() => void installFfmpegThenDownload()}>
                Install ffmpeg
              </button>
              <button
                className="player-ytbtn ghost"
                onClick={() => void skipFfmpegAndDownload()}
                title="Download a 720p copy now without installing ffmpeg"
              >
                Download at 720p
              </button>
            </span>
          ) : ytStatus === "error" ? (
            <span className="player-ytnote error">
              <span>Download failed{ytError ? `: ${ytError}` : "."}</span>
              <button className="player-ytbtn" onClick={() => void downloadActiveYouTube()}>
                Try again
              </button>
            </span>
          ) : ytLocalUrl ? (
            <span className="player-ytnote">
              Playing a downloaded copy — click-to-seek enabled.
              <button
                className="player-ytbtn"
                onClick={() => void downloadActiveYouTube({ force: true })}
                title="Discard this copy and download again at the best available quality"
              >
                Re-download in HD
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

          {/* Cookies import: lets yt-dlp reach signed-in / higher-quality formats.
              Offered whenever we're not mid-download (idle, ready, or after an error). */}
          {(ytStatus === "idle" || ytStatus === "error" || ytStatus === "ready") && (
            <button
              className="player-ytbtn ghost"
              onClick={() => void importCookies()}
              title="Import a cookies.txt exported from your browser so higher-quality (signed-in) formats can be downloaded"
            >
              {hasCookies ? "Cookies ✓" : "Use cookies file"}
            </button>
          )}
        </div>
      )}

      {/* Web build: an embedding-disabled video can't be downloaded for click-to-seek
          (a browser has no native downloader), so explain the limitation instead of
          failing silently. The desktop build handles this case via the strip above. */}
      {!isTauri && type === "youtube" && embedBlocked && !ytLocalUrl && (
        <div className="player-ytbar">
          <span className="player-ytnote web">
            Embedding is disabled for this video, so click-to-seek isn't available in the
            browser. The <strong>NoteTaker desktop app</strong> can download a seekable copy.
            {source?.url && (
              <>
                {" "}
                <a
                  className="player-ytlink"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Watch on YouTube ↗
                </a>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}

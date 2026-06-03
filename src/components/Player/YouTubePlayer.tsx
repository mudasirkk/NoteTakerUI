import { useEffect, useRef } from "react";
import { useStore } from "../../state/store";
import { YouTubeController, type YTPlayerLike } from "../../player/PlayerController";
import { loadYouTubeAPI, parseYouTubeId } from "../../player/youtubeApi";

export function YouTubePlayer({
  url,
  onEmbedBlocked,
}: {
  url: string;
  onEmbedBlocked?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const setController = useStore((s) => s.setController);
  const clearController = useStore((s) => s.clearController);
  // Hold the latest callback in a ref so the player effect doesn't re-run (tearing
  // down and rebuilding the iframe) just because the parent handed it a new closure.
  const onEmbedBlockedRef = useRef(onEmbedBlocked);
  onEmbedBlockedRef.current = onEmbedBlocked;

  useEffect(() => {
    const videoId = parseYouTubeId(url);
    const host = hostRef.current;
    if (!videoId || !host) return;

    let player: YTPlayerLike | null = null;
    let cancelled = false;
    const mount = document.createElement("div"); // API replaces this with an iframe
    host.appendChild(mount);

    void loadYouTubeAPI().then((YT) => {
      if (cancelled) return;
      player = new YT.Player(mount, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            player = e.target;
            setController(new YouTubeController(player));
          },
          // 101 / 150: the owner disabled embedding. On desktop we recover by
          // downloading the video and playing it back locally (DC-3) — the store
          // guards against duplicate/in-flight downloads. In a browser there is no
          // native downloader, so we also notify the panel so it can show a short
          // "use the desktop app" note (downloadActiveYouTube simply no-ops on web).
          onError: (e) => {
            if (cancelled) return;
            if (e.data === 101 || e.data === 150) {
              onEmbedBlockedRef.current?.();
              void useStore.getState().downloadActiveYouTube();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearController();
      try {
        player?.destroy();
      } catch {
        /* already gone */
      }
      host.replaceChildren();
    };
  }, [url, setController, clearController]);

  if (!parseYouTubeId(url)) {
    return <div className="player-warn">Couldn't read a YouTube ID from that link.</div>;
  }
  return <div className="yt-host" ref={hostRef} />;
}

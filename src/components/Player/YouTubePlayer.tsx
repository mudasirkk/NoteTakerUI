import { useEffect, useRef } from "react";
import { useStore } from "../../state/store";
import { YouTubeController, type YTPlayerLike } from "../../player/PlayerController";
import { loadYouTubeAPI, parseYouTubeId } from "../../player/youtubeApi";

export function YouTubePlayer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const setController = useStore((s) => s.setController);
  const clearController = useStore((s) => s.clearController);

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
          // 101 / 150: the owner disabled embedding. Rather than degrade to an
          // un-seekable timer, download the video and play it locally (DC-3). The
          // store guards against duplicate/in-flight downloads.
          onError: (e) => {
            if (cancelled) return;
            if (e.data === 101 || e.data === 150) {
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

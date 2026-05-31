// Loads the YouTube IFrame Player API once and resolves when it's ready.
import type { YTPlayerLike } from "./PlayerController";

export interface YTPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayerLike }) => void;
    // error codes 101 & 150 mean the owner disabled embedding — our cue to fall
    // back to a local download (DC-3). `data` is the YouTube error code.
    onError?: (e: { data: number }) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayerLike;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SRC = "https://www.youtube.com/iframe_api";
let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeAPI(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const tag = document.createElement("script");
      tag.src = SRC;
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

/** Accepts a full URL, a youtu.be link, an /embed|/shorts link, or a raw 11-char id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

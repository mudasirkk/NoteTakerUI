// Source-aware player abstraction.
// ExternalController is the session-timer fallback (no seek).
// YouTubeController + LocalVideoController wrap real media with canSeek = true.

import type { SourceType } from "../model/types";

export interface PlayerController {
  readonly type: SourceType;
  readonly canSeek: boolean;
  /** Seconds into the media, or session-elapsed seconds for external sources. */
  getCurrentTime(): number;
  seekTo(seconds: number): void; // no-op when !canSeek
  togglePlay(): void;
  skip(deltaSeconds: number): void;
  setRate(rate: number): void;
}

/** External source (Zoom, another app, etc.): a wall-clock session timer. */
export class ExternalController implements PlayerController {
  readonly type: SourceType = "external";
  readonly canSeek = false;
  private start: number;

  constructor(startEpochMs: number) {
    this.start = startEpochMs;
  }

  setStart(startEpochMs: number) {
    this.start = startEpochMs;
  }

  getCurrentTime(): number {
    return Math.max(0, (Date.now() - this.start) / 1000);
  }

  seekTo(): void {}
  togglePlay(): void {}
  skip(): void {}
  setRate(): void {}
}

/** Minimal slice of the YouTube IFrame Player API that we actually call. */
export interface YTPlayerLike {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number; // 1 = playing
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

const YT_PLAYING = 1;

/** Embedded YouTube via the IFrame Player API. Methods are sync once ready. */
export class YouTubeController implements PlayerController {
  readonly type: SourceType = "youtube";
  readonly canSeek = true;
  private player: YTPlayerLike;

  constructor(player: YTPlayerLike) {
    this.player = player;
  }

  getCurrentTime(): number {
    try {
      return this.player.getCurrentTime() || 0;
    } catch {
      return 0; // not ready yet
    }
  }

  seekTo(seconds: number): void {
    try {
      this.player.seekTo(Math.max(0, seconds), true);
    } catch {
      /* player not ready */
    }
  }

  togglePlay(): void {
    try {
      if (this.player.getPlayerState() === YT_PLAYING) this.player.pauseVideo();
      else this.player.playVideo();
    } catch {
      /* player not ready */
    }
  }

  skip(deltaSeconds: number): void {
    this.seekTo(this.getCurrentTime() + deltaSeconds);
  }

  setRate(rate: number): void {
    try {
      this.player.setPlaybackRate(rate);
    } catch {
      /* player not ready */
    }
  }
}

/** Embedded local file via an HTML5 <video> element. */
export class LocalVideoController implements PlayerController {
  readonly type: SourceType = "localVideo";
  readonly canSeek = true;
  private el: HTMLVideoElement;

  constructor(el: HTMLVideoElement) {
    this.el = el;
  }

  getCurrentTime(): number {
    return this.el.currentTime || 0;
  }

  seekTo(seconds: number): void {
    this.el.currentTime = Math.max(0, seconds);
  }

  togglePlay(): void {
    if (this.el.paused) void this.el.play();
    else this.el.pause();
  }

  skip(deltaSeconds: number): void {
    this.el.currentTime = Math.max(0, this.el.currentTime + deltaSeconds);
  }

  setRate(rate: number): void {
    this.el.playbackRate = rate;
  }
}

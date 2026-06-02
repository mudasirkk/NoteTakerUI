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

/**
 * External source (Zoom, in-person lecture, etc.): a wall-clock session timer with
 * a real pause model. `accrued` banks the seconds from completed running segments;
 * `runningSince` is the epoch ms the current segment began, or null while paused.
 * Elapsed = accrued + (running ? now − runningSince : 0). The model is persisted on
 * the map (sessionAccrued / sessionStart / sessionPaused) so a pause survives reload
 * and sync — a break no longer keeps the clock running and drifting later stamps.
 */
export class ExternalController implements PlayerController {
  readonly type: SourceType = "external";
  readonly canSeek = false;
  private accrued = 0;
  private runningSince: number | null;

  constructor(startEpochMs: number) {
    this.runningSince = startEpochMs;
  }

  /** Restore the timer from a persisted map. runningSince null ⇒ paused. */
  restore(accrued: number, runningSince: number | null) {
    this.accrued = Math.max(0, accrued);
    this.runningSince = runningSince;
  }

  getCurrentTime(): number {
    const live = this.runningSince === null ? 0 : (Date.now() - this.runningSince) / 1000;
    return Math.max(0, this.accrued + live);
  }

  get paused(): boolean {
    return this.runningSince === null;
  }

  /** Bank the in-flight segment and stop counting. No-op if already paused. */
  pause() {
    if (this.runningSince === null) return;
    this.accrued += (Date.now() - this.runningSince) / 1000;
    this.runningSince = null;
  }

  /** Start a fresh running segment. No-op if already running. */
  resume() {
    if (this.runningSince === null) this.runningSince = Date.now();
  }

  /** Zero the elapsed count, preserving the running/paused state. */
  reset() {
    this.accrued = 0;
    this.runningSince = this.runningSince === null ? null : Date.now();
  }

  /** Map-shaped state for persistence. accrued excludes the live segment by design. */
  snapshot(): { accrued: number; runningSince: number | null; paused: boolean } {
    return { accrued: this.accrued, runningSince: this.runningSince, paused: this.paused };
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

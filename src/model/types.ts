// Core data model for NoteTakerUI. One NoteMap per lecture.

export type SourceType = "youtube" | "localVideo" | "external";

export interface SourceRef {
  type: SourceType;
  url?: string; // youtube url/id
  filePath?: string; // local video file
  label?: string; // e.g. "Zoom lecture"
}

export interface NoteNode {
  id: string;
  parentId: string | null; // null = root-level
  order: number; // position among siblings
  text: string;
  timestamp: number | null; // seconds into media, or session-elapsed seconds
  collapsed: boolean;
  color?: string;
  tags: string[];
}

// A freeform cross-link between two notes, independent of the parent/child
// hierarchy (which is implied by NoteNode.parentId). Rendered as a distinct
// arrow in the map view.
export interface NoteLink {
  id: string;
  from: string; // source node id
  to: string; // target node id
}

// A single transcript/caption cue. Times are seconds into the media (the same
// scale as NoteNode.timestamp), so clicking a cue can seek the player and the
// "now playing" cue can be highlighted live. Imported from an .srt/.vtt file or
// pasted text — the app never fetches captions from a remote API (locked design
// decision: unified Google login only, no YouTube Data API).
export interface TranscriptCue {
  start: number; // seconds
  end: number; // seconds (>= start; derived from the next cue when a file omits it)
  text: string;
}

export interface NoteMap {
  id: string;
  title: string;
  source?: SourceRef;
  createdAt: string;
  updatedAt: string;
  // Monotonic per-map edit counter, bumped on every local mutation. Sync compares
  // by rev first and only falls back to updatedAt as a tiebreak, so a skewed wall
  // clock can't make an older edit win (FUN-2). Optional for back-compat: maps
  // written before this field default to 0 on load.
  rev?: number;
  // Session-timer state for external (live-lecture) sources. `sessionStart` is the
  // epoch ms when the *current running segment* began, or null while paused / no
  // session. `sessionAccrued` banks the seconds from segments before the current
  // one, so a Pause/Resume cycle survives reload + sync. Both optional for
  // back-compat: a map written before pause existed has a plain `sessionStart` and
  // no accrued/paused fields, which restores to the old "running since start"
  // behaviour exactly (accrued 0, not paused).
  sessionStart: number | null;
  sessionAccrued?: number; // seconds banked from completed running segments
  sessionPaused?: boolean; // true while the live-lecture timer is paused
  nodes: NoteNode[];
  links?: NoteLink[]; // optional so older persisted maps still parse
  transcript?: TranscriptCue[]; // optional imported captions, aligned to media time
}

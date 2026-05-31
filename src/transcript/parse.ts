// Transcript parsing — turns an imported .srt / .vtt file (or pasted text) into
// TranscriptCue[] aligned to media time. Pure, dependency-free, and tolerant of
// the messy variations real caption files come in. The app never fetches
// captions from a network API (locked design decision), so this is the only way
// a transcript enters a map.

import type { TranscriptCue } from "../model/types";

// "HH:MM:SS.mmm", "HH:MM:SS,mmm", "MM:SS.mmm", "MM:SS", or bare seconds "12.5".
function parseTimestamp(raw: string): number | null {
  const s = raw.trim();
  const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (hms) {
    const h = hms[1] ? Number(hms[1]) : 0;
    const m = Number(hms[2]);
    const sec = Number(hms[3]);
    const ms = hms[4] ? Number(hms[4].padEnd(3, "0")) : 0;
    return h * 3600 + m * 60 + sec + ms / 1000;
  }
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  return bare ? Number(bare[1]) : null;
}

// A cue's timing line, e.g. "00:00:01,000 --> 00:00:04,000 align:start".
// Captures only the two timestamp tokens; trailing VTT cue settings are ignored.
const TIMING = /([\d:.,]+)\s*-->\s*([\d:.,]+)/;

// Strip VTT inline markup (<c>, <00:00:01.000> karaoke tags, etc.) and collapse
// a multi-line cue into a single line of text.
function cleanCueText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

// SRT / WebVTT share the "start --> end" block shape. We scan for timing lines
// and gather the following non-blank lines as the cue text, which naturally
// skips WEBVTT headers, numeric indices, and NOTE/STYLE blocks.
function parseCueBlocks(text: string): TranscriptCue[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const cues: TranscriptCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(TIMING);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !TIMING.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    const cueText = cleanCueText(body);
    if (start != null && end != null && cueText) {
      cues.push({ start, end: Math.max(end, start), text: cueText });
    }
  }
  return cues;
}

// Fallback for pasted prose: any line that *starts* with a timestamp marker —
// "[01:23] …", "(1:23) …", "01:23 - …" — becomes a cue. Lines without a marker
// are ignored, so a transcript that's mostly text still yields useful anchors.
const MARKER = /^\s*[[(]?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)[\])]?\s*[-–—:]?\s+(.*\S)\s*$/;

function parseMarkers(text: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(MARKER);
    if (!m) continue;
    const start = parseTimestamp(m[1]);
    if (start == null) continue;
    cues.push({ start, end: start, text: m[2].trim() });
  }
  return cues;
}

// Sort by start time and fill in any missing/zero-length ends from the next
// cue's start (the last cue gets a short default), so live highlighting always
// has a window to test against.
function normalize(cues: TranscriptCue[]): TranscriptCue[] {
  const sorted = cues
    .filter((c) => c.text && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    const end = c.end > c.start ? c.end : next ? next.start : c.start + 4;
    return { start: c.start, end: Math.max(end, c.start), text: c.text };
  });
}

// Parse any supported transcript text into normalized cues. Returns [] when
// nothing recognizable is found, so callers can show a friendly "couldn't read
// that" message rather than storing junk.
export function parseTranscript(raw: string): TranscriptCue[] {
  if (!raw || !raw.trim()) return [];
  const cues = raw.includes("-->") ? parseCueBlocks(raw) : parseMarkers(raw);
  return normalize(cues);
}

// Index of the cue that contains time `t` (start <= t < end), or -1 in a gap /
// before the first cue. Binary search so it's cheap to call every animation
// frame even on a multi-thousand-cue transcript.
export function cueIndexAt(cues: TranscriptCue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 && t < cues[ans].end ? ans : -1;
}

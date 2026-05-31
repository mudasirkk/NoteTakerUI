// Defensive normalizer for NoteMap data arriving from any persistence boundary
// (localStorage, on-disk JSON, legacy migration, Firestore). Parsed JSON is
// untrusted: a hand-edited file, a partial cloud write, or an older/newer schema
// can all yield shapes that violate our types. Rather than trust `as NoteMap`,
// every load path runs the bytes through normalizeMap, which either returns a
// fully-shaped NoteMap or null (caller treats null as "not found / corrupt").

import type { NoteMap, NoteNode, NoteLink, SourceRef, SourceType, TranscriptCue } from "./types";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const SOURCE_TYPES: readonly SourceType[] = ["youtube", "localVideo", "external"];

function normalizeSource(v: unknown): SourceRef | undefined {
  if (!isObj(v)) return undefined;
  const type = v.type;
  if (typeof type !== "string" || !SOURCE_TYPES.includes(type as SourceType)) return undefined;
  return {
    type: type as SourceType,
    url: optStr(v.url),
    filePath: optStr(v.filePath),
    label: optStr(v.label),
  };
}

function normalizeNode(v: unknown): NoteNode | null {
  if (!isObj(v)) return null;
  const id = v.id;
  if (typeof id !== "string" || id === "") return null;
  const parentId = typeof v.parentId === "string" ? v.parentId : null;
  return {
    id,
    parentId,
    order: num(v.order, 0),
    text: str(v.text, ""),
    timestamp: numOrNull(v.timestamp),
    collapsed: bool(v.collapsed, false),
    color: optStr(v.color),
    tags: strArray(v.tags),
  };
}

function normalizeLink(v: unknown): NoteLink | null {
  if (!isObj(v)) return null;
  const { id, from, to } = v;
  if (typeof id !== "string" || typeof from !== "string" || typeof to !== "string") return null;
  return { id, from, to };
}

function normalizeCue(v: unknown): TranscriptCue | null {
  if (!isObj(v)) return null;
  if (typeof v.text !== "string") return null;
  const start = num(v.start, NaN);
  if (!Number.isFinite(start)) return null;
  // A missing/invalid end collapses to a zero-length cue at `start` rather than
  // dropping the line; never let end precede start.
  const end = Math.max(start, num(v.end, start));
  return { start, end, text: v.text };
}

export function normalizeMap(raw: unknown): NoteMap | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (!Array.isArray(raw.nodes)) return null;

  const nodes: NoteNode[] = [];
  const ids = new Set<string>();
  for (const n of raw.nodes) {
    const node = normalizeNode(n);
    if (node && !ids.has(node.id)) {
      ids.add(node.id);
      nodes.push(node);
    }
  }
  // Reparent any node whose parent was dropped/never existed so the tree stays
  // walkable (an orphaned parentId would strand the subtree out of the outline).
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) node.parentId = null;
  }

  // Keep only links whose endpoints both survive — a dangling link would draw an
  // arrow to nowhere and break the map renderer.
  const links: NoteLink[] = [];
  if (Array.isArray(raw.links)) {
    for (const l of raw.links) {
      const link = normalizeLink(l);
      if (link && ids.has(link.from) && ids.has(link.to)) links.push(link);
    }
  }

  let transcript: TranscriptCue[] | undefined;
  if (Array.isArray(raw.transcript)) {
    transcript = raw.transcript
      .map(normalizeCue)
      .filter((c): c is TranscriptCue => c !== null);
  }

  const now = new Date().toISOString();
  return {
    id: raw.id,
    title: str(raw.title, "Untitled"),
    source: normalizeSource(raw.source),
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now),
    rev: Math.max(0, Math.floor(num(raw.rev, 0))),
    sessionStart: numOrNull(raw.sessionStart),
    nodes,
    links,
    transcript,
  };
}

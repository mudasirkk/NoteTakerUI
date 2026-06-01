import { create } from "zustand";
import type { NoteMap, NoteNode, NoteLink, SourceRef, TranscriptCue } from "../model/types";
import * as ops from "./nodeOps";
import { activeStore, saveSync, getActiveMapId, setActiveMapId } from "../storage/fileStore";
import { ExternalController, type PlayerController } from "../player/PlayerController";
import { pickVideoFile, resolveVideoUrl } from "../platform/dialog";
import { downloadYouTube, cachedYouTube, ffmpegAvailable, installFfmpeg } from "../platform/youtubeDownload";
import { isTauri } from "../platform/window";
import { mapToMarkdown, suggestedFileName } from "../export/markdown";
import { saveTextFile } from "../platform/exportFile";
import { configureSync, pushLocalSave, pushLocalRemove, flushPush } from "../storage/sync";
import { loadPref, savePref } from "../platform/uiPrefs";
import { loadTheme, saveTheme, applyTheme, type ThemePref } from "../platform/theme";
import {
  type Layout,
  DEFAULT_LAYOUT,
  DEFAULT_SPLIT_RATIO,
  clampRatio,
  nextLayout,
} from "../platform/layout";
import { winSetAlwaysOnTop } from "../platform/window";

// The session timer is always alive; it is also the active controller whenever
// the source is "external". Media sources register their own controller when
// the embedded player becomes ready (see components/Player).
const sessionTimer = new ExternalController(Date.now());

const RATE_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Stamp a mutated map: refresh updatedAt and bump the monotonic rev counter that
// sync uses as its skew-proof ordering key (FUN-2). Every local edit goes through
// here so rev advances exactly once per change.
function touch(map: NoteMap): NoteMap {
  return { ...map, updatedAt: new Date().toISOString(), rev: (map.rev ?? 0) + 1 };
}

// --- Undo / redo (UX-2) -----------------------------------------------------
// Snapshot history of the editable map. We snapshot the whole NoteMap before a
// mutation (cheap for an outline) rather than recording inverse ops. Rapid text
// edits to a single node coalesce into one step via a per-run key, so Ctrl+Z
// doesn't crawl character-by-character. History is per-map and is cleared on any
// map switch (a snapshot carries its map id, so restoring across maps would be
// nonsense — see clearHistory in newMap/applyLoaded).
interface Snapshot {
  map: NoteMap;
  selectedId: string | null;
}
const HISTORY_CAP = 100;
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
let lastCoalesceKey: string | null = null;

function recordHistory(prev: NoteMap, prevSelectedId: string | null, coalesceKey: string | null) {
  if (coalesceKey !== null && coalesceKey === lastCoalesceKey && redoStack.length === 0) {
    // Continuation of a coalesced run (e.g. still typing in the same node): the
    // snapshot taken at the start of the run already holds the pre-edit state.
    return;
  }
  undoStack.push({ map: prev, selectedId: prevSelectedId });
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack.length = 0;
  lastCoalesceKey = coalesceKey;
}

function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastCoalesceKey = null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingMap: NoteMap | null = null;
// Remembers whether a download that hit the ffmpeg gate was a forced re-download,
// so the deferred fetch (after the user installs ffmpeg or skips it) keeps the
// force semantics rather than reusing the low-quality cached copy.
let pendingForce = false;
function scheduleSave(map: NoteMap) {
  pendingMap = map;
  clearTimeout(saveTimer);
  useStore.setState({ saving: true }); // drives the live status chip (UI-4)
  saveTimer = setTimeout(() => {
    pendingMap = null;
    saveTimer = undefined;
    void activeStore.save(map).finally(() => {
      // A newer edit may have queued while we were writing; only flip back to
      // "saved" once nothing is pending behind us.
      if (pendingMap === null) useStore.setState({ saving: false });
    });
  }, 400);
  // Mirror to the cloud when signed in; no-ops (and debounces) otherwise.
  pushLocalSave(map);
}

// Synchronous best-effort flush for the unload / window-hide path. During those
// events queued microtasks may never run, so the local write goes through the
// synchronous saveSync; any pending cloud push is kicked off too. Closes FUN-3.
export function flushPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (pendingMap) {
    saveSync(pendingMap);
    pendingMap = null;
  }
  flushPush();
}

// Awaitable flush for the desktop close-requested handler, which can hold the
// window open until the file write and cloud push have actually been issued.
export async function flushPendingSaveAsync(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const m = pendingMap;
  pendingMap = null;
  if (m) await activeStore.save(m);
  flushPush();
}

// Object URLs (browser fallback) must be released; asset:// URLs (Tauri) must not.
function revokeIfBlob(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function freshMap(): NoteMap {
  const root = ops.makeNode(null, 0, 0);
  const now = Date.now();
  return {
    id: ops.newId(),
    title: "Untitled lecture",
    source: { type: "external", label: "Lecture" },
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    rev: 0,
    sessionStart: now,
    nodes: [root],
    links: [],
  };
}

type View = "outline" | "map";

interface State {
  map: NoteMap;
  selectedId: string | null;
  view: View;
  autoStamp: boolean;
  paletteOpen: boolean;
  commandOpen: boolean;
  mapsOpen: boolean;
  transcriptOpen: boolean;
  helpOpen: boolean; // the "?" keyboard-shortcuts overlay (UI-3)
  mapsRev: number; // bumped when cloud sync changes the set of maps, so lists refetch
  saving: boolean; // a debounced local save is pending/in flight — drives the status chip
  syncNotice: string | null; // transient sync message (migration / conflict) for the toast (DC-2a)
  pinned: boolean; // window always-on-top, user-toggleable + persisted (UX-5)
  theme: ThemePref; // system / light / dark, persisted (UI-5)
  // v2 shell: one global, device-local layout pick + the shared divider position.
  // Both persist through uiPrefs (never per-map, never synced).
  layout: Layout;
  splitRatio: number;
  zoomRootId: string | null;
  controller: PlayerController;
  rate: number;
  localVideoUrl: string | null; // loadable URL (asset:// under Tauri, blob: in browser)
  // DC-3: device-local downloaded copy of a YouTube source. The map keeps only the
  // URL (DC-3c); this asset:// URL is transient per-device and, when present, the
  // player swaps the (embed-blocked) iframe for a seekable local <video>.
  ytLocalUrl: string | null;
  // "needs-ffmpeg": waiting on the user to accept the ffmpeg install (or pick 720p);
  // "installing-ffmpeg": fetching ffmpeg before a high-quality download.
  ytStatus: "idle" | "needs-ffmpeg" | "installing-ffmpeg" | "downloading" | "ready" | "error";
  ytError: string | null;

  init: () => Promise<void>;
  select: (id: string | null) => void;
  setTitle: (title: string) => void;

  // Multiple maps (Phase 3 — item 10)
  setMaps: (open: boolean) => void;
  newMap: () => Promise<void>;
  switchMap: (id: string) => Promise<void>;
  deleteMap: (id: string) => Promise<void>;

  setText: (id: string, text: string) => void;
  addSibling: (id: string) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  collapse: (id: string) => void;
  expand: (id: string) => void;
  toggleCollapse: (id: string) => void;
  removeIfEmpty: (id: string) => void;
  deleteSubtree: (id: string) => void;
  stamp: (id: string) => void;
  setView: (v: View) => void;
  toggleView: () => void;
  toggleAutoStamp: () => void;
  setPalette: (open: boolean) => void;
  setHelp: (open: boolean) => void;
  setSyncNotice: (msg: string | null) => void;
  togglePin: () => void;
  setTheme: (pref: ThemePref) => void;
  cycleTheme: () => void;
  setLayout: (layout: Layout) => void;
  cycleLayout: (dir: 1 | -1) => void;
  setSplitRatio: (ratio: number, persist?: boolean) => void;
  resetSession: () => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  exportMarkdown: () => Promise<void>;
  elapsed: () => number;

  // Source + player (Phase 2)
  setSource: (source: SourceRef) => void;
  openLocalVideo: () => Promise<void>;
  downloadActiveYouTube: (opts?: { skipFfmpegCheck?: boolean; force?: boolean }) => Promise<void>;
  installFfmpegThenDownload: () => Promise<void>;
  skipFfmpegAndDownload: () => Promise<void>;
  setController: (c: PlayerController) => void;
  clearController: () => void;
  playPause: () => void;
  skip: (deltaSeconds: number) => void;
  stepRate: (dir: -1 | 1) => void;
  seekToNode: (id: string) => void;

  // Command palette, zoom, tags/colors (Phase 2 — item 12)
  setCommand: (open: boolean) => void;
  setZoom: (id: string | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  collapseAll: () => void;
  expandAll: () => void;
  setColor: (id: string, color?: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;

  // Freeform cross-links (Phase 3 — item 11)
  addLink: (from: string, to: string) => void;
  removeLink: (id: string) => void;

  // Transcript enrichment (Phase 3 — final item)
  setTranscript: (cues: TranscriptCue[]) => void;
  clearTranscript: () => void;
  setTranscriptOpen: (open: boolean) => void;
  addNoteFromCue: (cue: TranscriptCue) => void;
}

export const useStore = create<State>((set, get) => {
  const stampSeconds = (): number | null =>
    get().autoStamp ? Math.floor(get().controller.getCurrentTime()) : null;

  const commit = (nodes: NoteNode[], selectedId?: string | null, coalesceKey?: string | null) => {
    recordHistory(get().map, get().selectedId, coalesceKey ?? null);
    const map: NoteMap = touch({ ...get().map, nodes });
    if (selectedId === undefined) set({ map });
    else set({ map, selectedId });
    scheduleSave(map);
  };

  // Restore a history snapshot. Re-stamp it (touch) from the *current* rev so the
  // undone/redone state moves the monotonic counter forward — otherwise it would
  // carry an old, lower rev and lose to the cloud copy or never propagate (FUN-2).
  const restoreSnapshot = (snap: Snapshot) => {
    const map = touch({ ...snap.map, rev: get().map.rev ?? 0 });
    const exists = snap.selectedId !== null && map.nodes.some((n) => n.id === snap.selectedId);
    const selectedId = exists ? snap.selectedId : ops.visibleRows(map.nodes)[0]?.node.id ?? null;
    set({ map, selectedId });
    scheduleSave(map);
  };

  // If the open map's YouTube source already has a downloaded copy cached on this
  // device, light up local (seekable) playback immediately — no re-download (DC-3).
  // Guards against a map switch racing the async lookup before applying the result.
  const refreshYouTubeLocal = async (map: NoteMap) => {
    if (map.source?.type !== "youtube" || !map.source.url) return;
    const cached = await cachedYouTube(map.source.url);
    if (cached && get().map.id === map.id) set({ ytLocalUrl: cached, ytStatus: "ready" });
  };

  // Make a freshly-loaded map the live one: reset the session timer, rebuild the
  // local-video URL from its persisted path, and drop back to the session-timer
  // controller (embedded players re-register themselves when they remount).
  const applyLoaded = async (loaded: NoteMap) => {
    clearHistory(); // history is per-map; don't let Ctrl+Z reach the previous map
    revokeIfBlob(get().localVideoUrl);
    sessionTimer.setStart(loaded.sessionStart ?? Date.now());
    let localVideoUrl: string | null = null;
    if (loaded.source?.type === "localVideo" && loaded.source.filePath) {
      localVideoUrl = await resolveVideoUrl(loaded.source.filePath);
    }
    set({
      map: loaded,
      selectedId: ops.visibleRows(loaded.nodes)[0]?.node.id ?? null,
      localVideoUrl,
      controller: sessionTimer,
      rate: 1,
      zoomRootId: null,
      transcriptOpen: false,
      ytLocalUrl: null,
      ytStatus: "idle",
      ytError: null,
    });
    void refreshYouTubeLocal(loaded);
  };

  return {
    map: freshMap(),
    selectedId: null,
    view: "outline",
    autoStamp: true,
    paletteOpen: false,
    commandOpen: false,
    mapsOpen: false,
    transcriptOpen: false,
    helpOpen: false,
    mapsRev: 0,
    saving: false,
    syncNotice: null,
    pinned: loadPref("pinned", true),
    theme: loadTheme(),
    layout: loadPref<Layout>("layout", DEFAULT_LAYOUT),
    splitRatio: loadPref<number>("splitRatio", DEFAULT_SPLIT_RATIO),
    zoomRootId: null,
    controller: sessionTimer,
    rate: 1,
    localVideoUrl: null,
    ytLocalUrl: null,
    ytStatus: "idle",
    ytError: null,

    init: async () => {
      // Re-apply the persisted pin state on launch: the window starts always-on-top
      // per config, so this only matters when the user previously unpinned. No-op in
      // a plain browser. (Theme is applied earlier, in main.tsx, to avoid a flash.)
      void winSetAlwaysOnTop(get().pinned);
      const metas = await activeStore.list();
      if (metas.length === 0) {
        // First run: persist the fresh map created in the initial state.
        const m = get().map;
        sessionTimer.setStart(m.sessionStart ?? Date.now());
        setActiveMapId(m.id);
        set({ selectedId: m.nodes[0]?.id ?? null });
        void activeStore.save(m);
        return;
      }
      const activeId = getActiveMapId();
      const targetId =
        activeId && metas.some((x) => x.id === activeId) ? activeId : metas[0].id;
      const loaded = await activeStore.load(targetId);
      if (loaded && loaded.nodes?.length) {
        setActiveMapId(loaded.id);
        await applyLoaded(loaded);
      } else {
        const m = get().map;
        sessionTimer.setStart(m.sessionStart ?? Date.now());
        setActiveMapId(m.id);
        set({ selectedId: m.nodes[0]?.id ?? null });
        void activeStore.save(m);
      }
    },

    setMaps: (open) => set({ mapsOpen: open }),
    newMap: async () => {
      const m = freshMap();
      clearHistory(); // fresh map starts with no undo history
      setActiveMapId(m.id);
      revokeIfBlob(get().localVideoUrl);
      sessionTimer.setStart(m.sessionStart ?? Date.now());
      set({
        map: m,
        selectedId: m.nodes[0]?.id ?? null,
        localVideoUrl: null,
        controller: sessionTimer,
        rate: 1,
        zoomRootId: null,
        mapsOpen: false,
        transcriptOpen: false,
        ytLocalUrl: null,
        ytStatus: "idle",
        ytError: null,
      });
      await activeStore.save(m);
    },
    switchMap: async (id) => {
      if (id === get().map.id) {
        set({ mapsOpen: false });
        return;
      }
      const loaded = await activeStore.load(id);
      if (!loaded) return;
      setActiveMapId(id);
      await applyLoaded(loaded);
      set({ mapsOpen: false });
    },
    deleteMap: async (id) => {
      await activeStore.remove(id);
      pushLocalRemove(id);
      if (id !== get().map.id) return; // removed a background map; nothing else to do
      // Deleted the active map — open the next most-recent, or start fresh.
      const metas = await activeStore.list();
      if (metas.length > 0) {
        const loaded = await activeStore.load(metas[0].id);
        if (loaded) {
          setActiveMapId(loaded.id);
          await applyLoaded(loaded);
          return;
        }
      }
      await get().newMap();
    },

    select: (id) => set({ selectedId: id }),
    setTitle: (title) => {
      recordHistory(get().map, get().selectedId, "title"); // coalesce title typing
      const map = touch({ ...get().map, title });
      set({ map });
      scheduleSave(map);
    },
    setText: (id, text) =>
      commit(
        get().map.nodes.map((n) => (n.id === id ? { ...n, text } : n)),
        undefined,
        "text:" + id // coalesce consecutive keystrokes in one node into a single undo
      ),
    addSibling: (id) => {
      const { nodes, id: nid } = ops.insertSiblingAfter(get().map.nodes, id, stampSeconds());
      commit(nodes, nid);
    },
    indent: (id) => commit(ops.indent(get().map.nodes, id)),
    outdent: (id) => commit(ops.outdent(get().map.nodes, id)),
    move: (id, dir) => commit(ops.moveWithinSiblings(get().map.nodes, id, dir)),
    collapse: (id) => commit(ops.setCollapsed(get().map.nodes, id, true)),
    expand: (id) => commit(ops.setCollapsed(get().map.nodes, id, false)),
    toggleCollapse: (id) => {
      const n = get().map.nodes.find((x) => x.id === id);
      if (n) commit(ops.setCollapsed(get().map.nodes, id, !n.collapsed));
    },
    removeIfEmpty: (id) => {
      const nodes = get().map.nodes;
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      const hasChildren = ops.childrenOf(nodes, id).length > 0;
      if (n.text !== "" || hasChildren || nodes.length <= 1) return;
      recordHistory(get().map, get().selectedId, null);
      const prev = ops.prevVisibleId(nodes, id);
      const links = (get().map.links ?? []).filter((l) => l.from !== id && l.to !== id);
      const map = touch({
        ...get().map,
        nodes: ops.deleteNode(nodes, id),
        links,
      });
      set({ map, selectedId: prev });
      scheduleSave(map);
    },
    // Delete a note and its whole subtree (FUN-5). Unlike removeIfEmpty this is an
    // explicit, possibly-destructive action (the caller confirms when there are
    // children), so it also prunes any cross-links touching the removed nodes and
    // clears the zoom root if it fell inside the deleted subtree.
    deleteSubtree: (id) => {
      const nodes = get().map.nodes;
      const node = nodes.find((x) => x.id === id);
      if (!node) return;
      recordHistory(get().map, get().selectedId, null);
      const prev = ops.prevVisibleId(nodes, id);
      const removed = ops.descendantsOf(nodes, id);
      removed.add(id);
      let remaining = ops.deleteNode(nodes, id);
      // Never leave the outline empty — seed a single blank root if we cleared it.
      if (remaining.length === 0) remaining = [ops.makeNode(null, 0, null)];
      const links = (get().map.links ?? []).filter((l) => !removed.has(l.from) && !removed.has(l.to));
      const stillThere = (sid: string | null): boolean =>
        sid !== null && remaining.some((n) => n.id === sid);
      const selectedId = stillThere(prev) ? prev : ops.visibleRows(remaining)[0]?.node.id ?? null;
      const zoom = get().zoomRootId;
      const zoomRootId = zoom && removed.has(zoom) ? null : zoom;
      const map = touch({ ...get().map, nodes: remaining, links });
      set({ map, selectedId, zoomRootId });
      scheduleSave(map);
    },
    stamp: (id) =>
      commit(
        get().map.nodes.map((n) =>
          n.id === id ? { ...n, timestamp: Math.floor(get().controller.getCurrentTime()) } : n
        )
      ),
    setView: (v) => set({ view: v }),
    toggleView: () => set({ view: get().view === "outline" ? "map" : "outline" }),
    toggleAutoStamp: () => set({ autoStamp: !get().autoStamp }),
    setPalette: (open) => set({ paletteOpen: open }),
    setHelp: (open) => set({ helpOpen: open }),
    setSyncNotice: (msg) => set({ syncNotice: msg }),
    // Pin/unpin always-on-top (UX-5): persist the choice and push it to the OS
    // window immediately. No-op on the window call in a plain browser.
    togglePin: () => {
      const next = !get().pinned;
      savePref("pinned", next);
      set({ pinned: next });
      void winSetAlwaysOnTop(next);
    },
    // Theme (UI-5): persist, apply to <html>, and mirror into state so the toggle
    // UI re-renders. applyTheme is idempotent and safe to call repeatedly.
    setTheme: (pref) => {
      saveTheme(pref);
      applyTheme(pref);
      set({ theme: pref });
    },
    cycleTheme: () => {
      const order: ThemePref[] = ["system", "light", "dark"];
      get().setTheme(order[(order.indexOf(get().theme) + 1) % order.length]);
    },
    // Layout (v2 shell): a single global pick, persisted device-local. Switching
    // re-clamps the shared divider into the new layout's band so a wide split
    // ratio doesn't leave theater's notes rail oversized.
    setLayout: (layout) => {
      savePref("layout", layout);
      set({ layout, splitRatio: clampRatio(layout, get().splitRatio) });
    },
    cycleLayout: (dir) => {
      const layout = nextLayout(get().layout, dir);
      savePref("layout", layout);
      set({ layout, splitRatio: clampRatio(layout, get().splitRatio) });
    },
    // The divider writes here on every pointermove (persist=false, cheap) and once
    // more on release (persist=true) so only the final position hits storage.
    setSplitRatio: (ratio, persist = false) => {
      const splitRatio = clampRatio(get().layout, ratio);
      if (persist) savePref("splitRatio", splitRatio);
      set({ splitRatio });
    },
    resetSession: () => {
      const now = Date.now();
      sessionTimer.setStart(now);
      const map = touch({ ...get().map, sessionStart: now });
      set({ map });
      scheduleSave(map);
    },
    undo: () => {
      const snap = undoStack.pop();
      if (!snap) return;
      redoStack.push({ map: get().map, selectedId: get().selectedId });
      lastCoalesceKey = null; // the next edit starts a fresh coalesce run
      restoreSnapshot(snap);
    },
    redo: () => {
      const snap = redoStack.pop();
      if (!snap) return;
      undoStack.push({ map: get().map, selectedId: get().selectedId });
      lastCoalesceKey = null;
      restoreSnapshot(snap);
    },
    save: () => void activeStore.save(get().map),
    exportMarkdown: async () => {
      const map = get().map;
      await saveTextFile(suggestedFileName(map.title), mapToMarkdown(map), [
        { name: "Markdown", extensions: ["md"] },
      ]);
    },
    elapsed: () => get().controller.getCurrentTime(),

    setSource: (source) => {
      revokeIfBlob(get().localVideoUrl);
      const map = touch({ ...get().map, source });
      // Switching sources drops any device-local YouTube download state (DC-3); a new
      // YouTube source then re-checks the cache so an already-downloaded copy plays.
      const ytReset = { ytLocalUrl: null, ytStatus: "idle" as const, ytError: null };
      // External reverts to the session timer immediately; YouTube registers its
      // controller once the embedded player is ready. (Local video goes through
      // openLocalVideo, which picks a file and builds the loadable URL.)
      if (source.type === "external")
        set({ map, controller: sessionTimer, rate: 1, localVideoUrl: null, ...ytReset });
      else set({ map, localVideoUrl: null, ...ytReset });
      scheduleSave(map);
      if (source.type === "youtube") void refreshYouTubeLocal(map);
    },
    openLocalVideo: async () => {
      const picked = await pickVideoFile();
      if (!picked) return; // cancelled
      revokeIfBlob(get().localVideoUrl);
      // filePath is only set under Tauri; that's what makes the choice persist.
      const source: SourceRef = { type: "localVideo", label: picked.label, filePath: picked.path };
      const map = touch({ ...get().map, source });
      set({ map, localVideoUrl: picked.url, rate: 1 });
      scheduleSave(map);
    },
    // DC-3: fetch the active YouTube video into the local cache and switch playback
    // to a seekable local <video>. Fires automatically when the embed is blocked
    // (YouTubePlayer's onError) and is also offered as a manual action. Idempotent:
    // it won't start a second download or re-fetch once a local copy is ready.
    downloadActiveYouTube: async (opts) => {
      const src = get().map.source;
      if (!src || src.type !== "youtube" || !src.url) return;
      const st = get().ytStatus;
      if (st === "downloading" || st === "installing-ffmpeg") return;
      // A copy is already playing and this isn't a forced re-download → nothing to do.
      if (get().ytLocalUrl && !opts?.force) return;
      // High-quality (>720p) downloads need ffmpeg to merge YouTube's separate
      // video+audio streams. If it's missing, stop and ask the user first (the ytbar
      // then offers to install ffmpeg for 1080p, or grab a 720p copy now). We stash
      // whether this was a forced re-download so the deferred fetch keeps that intent.
      // Skipped once they've chosen, and never gates the browser (no shell there).
      if (!opts?.skipFfmpegCheck && isTauri && !(await ffmpegAvailable())) {
        pendingForce = opts?.force ?? false;
        set({ ytStatus: "needs-ffmpeg", ytError: null });
        return;
      }
      const mapId = get().map.id;
      const url = src.url;
      set({ ytStatus: "downloading", ytError: null });
      try {
        const local = await downloadYouTube(url, opts?.force ?? false);
        if (get().map.id !== mapId) return; // user switched maps mid-download
        if (local) {
          // The cached file path (and thus its asset:// URL) is stable per video id,
          // so a forced re-download yields the same URL string — append a cache-buster
          // so React reloads the <video> instead of keeping the stale copy on screen.
          const busted = opts?.force
            ? `${local}${local.includes("?") ? "&" : "?"}t=${Date.now()}`
            : local;
          set({ ytLocalUrl: busted, ytStatus: "ready", ytError: null });
        } else set({ ytStatus: "idle" }); // browser: no native downloader, no-op
      } catch (e) {
        if (get().map.id !== mapId) return;
        set({ ytStatus: "error", ytError: e instanceof Error ? e.message : String(e) });
      }
    },
    // The user accepted the ffmpeg install: fetch it, then run the (now high-quality)
    // download, preserving the forced-re-download intent stashed at the gate. On
    // install failure we surface the error and stop, so the "Try again" path can retry.
    installFfmpegThenDownload: async () => {
      const st = get().ytStatus;
      if (st === "downloading" || st === "installing-ffmpeg") return;
      const src = get().map.source;
      if (!src || src.type !== "youtube" || !src.url) return;
      const force = pendingForce;
      set({ ytStatus: "installing-ffmpeg", ytError: null });
      try {
        await installFfmpeg();
      } catch (e) {
        set({ ytStatus: "error", ytError: e instanceof Error ? e.message : String(e) });
        return;
      }
      // Hand back to the normal path with the ffmpeg check already satisfied.
      set({ ytStatus: "idle" });
      await get().downloadActiveYouTube({ skipFfmpegCheck: true, force });
    },
    // The user declined ffmpeg and wants the 720p copy now: download straight away,
    // bypassing the ffmpeg gate but keeping any forced-re-download intent.
    skipFfmpegAndDownload: async () => {
      await get().downloadActiveYouTube({ skipFfmpegCheck: true, force: pendingForce });
    },
    setController: (c) => set({ controller: c }),
    clearController: () => set({ controller: sessionTimer }),
    playPause: () => get().controller.togglePlay(),
    skip: (deltaSeconds) => get().controller.skip(deltaSeconds),
    stepRate: (dir) => {
      const cur = get().rate;
      let i = RATE_STEPS.indexOf(cur);
      if (i === -1) i = RATE_STEPS.indexOf(1);
      const next = RATE_STEPS[Math.min(RATE_STEPS.length - 1, Math.max(0, i + dir))];
      get().controller.setRate(next);
      set({ rate: next });
    },
    seekToNode: (id) => {
      const n = get().map.nodes.find((x) => x.id === id);
      const c = get().controller;
      if (n && n.timestamp != null && c.canSeek) c.seekTo(n.timestamp);
    },

    setCommand: (open) => set({ commandOpen: open }),
    setZoom: (id) => set({ zoomRootId: id }),
    zoomIn: () => {
      const id = get().selectedId;
      if (id) set({ zoomRootId: id });
    },
    zoomOut: () => {
      const z = get().zoomRootId;
      if (!z) return;
      const node = get().map.nodes.find((n) => n.id === z);
      set({ zoomRootId: node?.parentId ?? null });
    },
    collapseAll: () => {
      const nodes = get().map.nodes;
      const parents = new Set(
        nodes.map((n) => n.parentId).filter((p): p is string => p !== null)
      );
      commit(nodes.map((n) => (parents.has(n.id) ? { ...n, collapsed: true } : n)));
    },
    expandAll: () => commit(get().map.nodes.map((n) => (n.collapsed ? { ...n, collapsed: false } : n))),
    setColor: (id, color) =>
      commit(get().map.nodes.map((n) => (n.id === id ? { ...n, color } : n))),
    addTag: (id, tag) => {
      const t = tag.trim().replace(/^#/, "");
      if (!t) return;
      commit(
        get().map.nodes.map((n) =>
          n.id === id ? (n.tags.includes(t) ? n : { ...n, tags: [...n.tags, t] }) : n
        )
      );
    },
    removeTag: (id, tag) =>
      commit(
        get().map.nodes.map((n) =>
          n.id === id ? { ...n, tags: n.tags.filter((x) => x !== tag) } : n
        )
      ),

    addLink: (from, to) => {
      if (from === to) return;
      const links = get().map.links ?? [];
      if (links.some((l) => l.from === from && l.to === to)) return; // no duplicates
      recordHistory(get().map, get().selectedId, null);
      const link: NoteLink = { id: ops.newId(), from, to };
      const map = touch({ ...get().map, links: [...links, link] });
      set({ map });
      scheduleSave(map);
    },
    removeLink: (id) => {
      recordHistory(get().map, get().selectedId, null);
      const links = (get().map.links ?? []).filter((l) => l.id !== id);
      const map = touch({ ...get().map, links });
      set({ map });
      scheduleSave(map);
    },

    // Transcript rides inside the NoteMap, so it persists and cloud-syncs through
    // the same scheduleSave path as everything else — no separate storage needed.
    setTranscript: (cues) => {
      recordHistory(get().map, get().selectedId, null);
      const map = touch({ ...get().map, transcript: cues });
      set({ map, transcriptOpen: cues.length > 0 });
      scheduleSave(map);
    },
    clearTranscript: () => {
      recordHistory(get().map, get().selectedId, null);
      const map = touch({ ...get().map, transcript: [] });
      set({ map, transcriptOpen: false });
      scheduleSave(map);
    },
    setTranscriptOpen: (open) => set({ transcriptOpen: open }),
    // Drop a cue into the outline as a new note, time-stamped to that moment, so
    // the transcript becomes a source the user can build structured notes from.
    addNoteFromCue: (cue) => {
      const nodes = get().map.nodes;
      const rows = ops.visibleRows(nodes);
      const ref = get().selectedId ?? rows[rows.length - 1]?.node.id ?? null;
      if (!ref) return;
      const { nodes: next, id } = ops.insertSiblingAfter(nodes, ref, Math.floor(cue.start));
      const text = cue.text.trim();
      commit(
        next.map((n) => (n.id === id ? { ...n, text } : n)),
        id
      );
    },
  };
});

// Tell the cloud-sync engine which map is currently open (so it won't overwrite
// live edits) and how to nudge map lists to refetch after a remote change.
configureSync({
  activeMapId: () => useStore.getState().map.id,
  onMapsChanged: () => useStore.setState((s) => ({ mapsRev: s.mapsRev + 1 })),
  // A local edit is "in flight" while a debounced save is still pending; until it
  // lands we refuse to let a remote echo replace the map under the user (FUN-2).
  isActiveDirty: () => pendingMap !== null,
  // Apply a strictly-newer remote version of the open map in place. We keep the
  // running session timer anchored and leave the player/zoom/rate untouched — only
  // the note content is reconciled — and preserve the selection when it survives.
  applyRemoteToActive: (incoming) => {
    const s = useStore.getState();
    const map: NoteMap = { ...incoming, sessionStart: s.map.sessionStart };
    const keep = s.selectedId !== null && map.nodes.some((n) => n.id === s.selectedId);
    const selectedId = keep ? s.selectedId : ops.visibleRows(map.nodes)[0]?.node.id ?? null;
    useStore.setState({ map, selectedId });
  },
  // Surface migration / conflict messages as a transient toast (DC-2a's "clear
  // user messaging"). The SyncNotice component reads this and auto-dismisses.
  notify: (msg) => useStore.getState().setSyncNotice(msg),
});

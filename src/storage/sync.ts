// Account-scoped Firestore sync (DC-2). The cloud (users/<uid>/maps/<id>) is the
// source of truth for a signed-in account; the on-disk / localStorage store
// (activeStore) is a local working copy / cache. This layer mirrors the two and
// reconciles them.
//
// Conflict handling (DC-2b): we remember the content we last agreed on with the
// cloud for each map (a per-map "base"). That lets us tell a clean fast-forward
// (only one side moved) from a true divergence (both sides edited the same map,
// e.g. one device was offline). On a fast-forward we take the newer side; on a
// true divergence we keep BOTH — the newer version stays canonical and the loser
// is preserved as a deterministic "(conflict copy)" — so no edit is silently
// lost the way plain last-write-wins would. The offline write queue (retry map,
// flushed on reconnect) covers edits made while disconnected.
//
// The map the user currently has open ("active") is still treated gently: a
// pending local edit defers a remote apply, and we never delete it out from under
// the cursor. But it is no longer skipped wholesale — a newer remote version is
// applied in place, and a true divergence forks the loser rather than dropping it.

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { NoteMap } from "../model/types";
import { normalizeMap } from "../model/normalize";
import { activeStore } from "./fileStore";

interface RemoteDoc {
  id: string;
  title: string;
  updatedAt: string;
  rev: number; // monotonic edit counter — the primary, skew-proof ordering key
  json: string; // the full NoteMap, serialized — sidesteps Firestore's type quirks
}

export interface SyncHandlers {
  activeMapId: () => string | null;
  onMapsChanged: () => void;
  // True when the open map has an unsaved local edit in flight; sync won't replace
  // the active map under the user while this holds (FUN-2).
  isActiveDirty: () => boolean;
  // Apply a strictly-newer remote version of the currently-open map in place.
  applyRemoteToActive: (map: NoteMap) => void;
  // Surface a short, user-facing sync notice (first-sign-in migration count, a
  // conflict copy being created). Optional — no-ops if the host doesn't supply it.
  notify?: (message: string) => void;
}

// Compare two versions by the monotonic rev first, falling back to the wall-clock
// updatedAt only as a tiebreak. Using rev as the primary key means a skewed client
// clock can no longer let an older edit win the merge (FUN-2). `a` is "newer".
function isNewer(
  a: { rev?: number; updatedAt: string },
  b: { rev?: number; updatedAt: string }
): boolean {
  const ar = a.rev ?? 0;
  const br = b.rev ?? 0;
  if (ar !== br) return ar > br;
  return a.updatedAt > b.updatedAt;
}

// FNV-1a hash of a map's *meaningful content* (excluding the volatile rev /
// updatedAt). Two devices that produced identical content hash equal, so an echo
// of our own write is recognised and a real divergence is detected (DC-2b).
function contentHash(map: NoteMap): string {
  const canon = JSON.stringify({
    title: map.title,
    source: map.source ?? null,
    nodes: map.nodes,
    links: map.links ?? [],
    transcript: map.transcript ?? [],
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// The default fresh map (a single empty root, default title, no content). We never
// push these to the account, so signing in on a new device doesn't litter the
// cloud with blank "Untitled lecture" maps (DC-2a).
function isThrowawayEmpty(map: NoteMap): boolean {
  const nodes = map.nodes ?? [];
  if (nodes.length !== 1) return false;
  const emptyText = (nodes[0].text ?? "").trim() === "";
  const noLinks = (map.links?.length ?? 0) === 0;
  const noTranscript = (map.transcript?.length ?? 0) === 0;
  const defaultTitle = map.title.trim() === "" || map.title === "Untitled lecture";
  return emptyText && noLinks && noTranscript && defaultTitle;
}

function stripConflictSuffix(title: string): string {
  return title.replace(/ \(conflict copy\)$/, "");
}

// Build the keep-both copy of the losing side of a conflict. The id is derived
// deterministically from the loser's id + content hash so BOTH devices generate
// the identical copy (same id, same body) and Firestore converges to a single
// extra doc instead of one per device.
function forkConflict(loser: NoteMap): NoteMap {
  const h = contentHash(loser);
  return {
    ...loser,
    id: `conflict-${loser.id}-${h}`,
    title: stripConflictSuffix(loser.title) + " (conflict copy)",
  };
}

let handlers: SyncHandlers | null = null;
let db: Firestore | null = null;
let uid: string | null = null;
let unsub: Unsubscribe | null = null;
// Per-map pending cloud push: keep the latest map alongside its debounce timer so
// the write can be flushed immediately on app exit (see flushPush).
const pendingPush = new Map<string, { map: NoteMap; timer: ReturnType<typeof setTimeout> }>();
// Cloud pushes that failed (offline / transient), keyed by map id — latest wins.
// Flushed when the browser fires `online`. Closes FUN-2's "no offline write queue".
const retry = new Map<string, NoteMap>();

// Last content we agreed on with the cloud, per map id, for the signed-in account.
// Persisted so divergence detection survives a reload (DC-2b).
type Base = Record<string, { rev: number; hash: string }>;
let base: Base = {};
const baseKey = (userId: string) => `notetaker:sync:base:${userId}`;
const migratedKey = (userId: string) => `notetaker:sync:migrated:${userId}`;
function loadBase(userId: string): Base {
  try {
    const raw = localStorage.getItem(baseKey(userId));
    return raw ? (JSON.parse(raw) as Base) : {};
  } catch {
    return {};
  }
}
function persistBase(): void {
  if (!uid) return;
  try {
    localStorage.setItem(baseKey(uid), JSON.stringify(base));
  } catch {
    /* storage unavailable — divergence detection degrades to conservative keep-both */
  }
}
function setBase(map: NoteMap): void {
  base[map.id] = { rev: map.rev ?? 0, hash: contentHash(map) };
  persistBase();
}
function clearBase(id: string): void {
  if (base[id]) {
    delete base[id];
    persistBase();
  }
}

export function configureSync(h: SyncHandlers): void {
  handlers = h;
}

function mapsCol(database: Firestore, userId: string) {
  return collection(database, "users", userId, "maps");
}

function serialize(map: NoteMap): RemoteDoc {
  return {
    id: map.id,
    title: map.title,
    updatedAt: map.updatedAt,
    rev: map.rev ?? 0,
    json: JSON.stringify(map),
  };
}

function deserialize(data: DocumentData): NoteMap | null {
  try {
    return normalizeMap(JSON.parse((data as RemoteDoc).json));
  } catch {
    return null;
  }
}

// Save a map into the local working copy and record it as the agreed base.
async function saveLocal(map: NoteMap): Promise<void> {
  await activeStore.save(map);
  setBase(map);
}

async function pushIfPossible(map: NoteMap): Promise<void> {
  if (!db || !uid) return;
  await pushNow(db, uid, map);
}

export async function startSync(database: Firestore, userId: string): Promise<void> {
  stopSync();
  db = database;
  uid = userId;
  base = loadBase(userId);
  try {
    await reconcile();
  } catch (e) {
    console.warn("initial sync reconcile failed", e);
  }
  subscribe();
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);
}

export function stopSync(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
  for (const { timer } of pendingPush.values()) clearTimeout(timer);
  pendingPush.clear();
  retry.clear();
  base = {};
  db = null;
  uid = null;
}

// Reconcile one remote map against the local copy: pull, fast-forward, push, or —
// when both sides have diverged from the agreed base — keep both. Returns true if
// the visible set of maps changed (so the switcher refetches).
async function ingestRemote(id: string, remote: NoteMap): Promise<boolean> {
  const activeId = handlers?.activeMapId() ?? null;
  const local = await activeStore.load(id);

  // No local copy yet → straightforward pull (cloud is the source of truth).
  if (!local) {
    if (id === activeId) {
      if (handlers?.isActiveDirty()) return false;
      await saveLocal(remote);
      handlers?.applyRemoteToActive(remote);
      return false;
    }
    await saveLocal(remote);
    return true;
  }

  const lh = contentHash(local);
  const rh = contentHash(remote);
  if (lh === rh) {
    // Identical content (commonly our own write echoing back) — just sync the base.
    setBase(remote);
    return false;
  }

  const b = base[id];
  const localChanged = !b || b.hash !== lh;
  const remoteChanged = !b || b.hash !== rh;

  // Only the cloud moved → clean fast-forward, safe to take.
  if (remoteChanged && !localChanged) {
    if (id === activeId) {
      if (handlers?.isActiveDirty()) return false; // a local edit is pending; retry later
      await saveLocal(remote);
      handlers?.applyRemoteToActive(remote);
      return false;
    }
    await saveLocal(remote);
    return true;
  }

  // Only we moved → our copy is ahead; push it up.
  if (localChanged && !remoteChanged) {
    await pushIfPossible(local);
    return false;
  }

  // Both moved since the agreed base → true conflict → keep both (DC-2b). Defer if
  // the open map has an in-flight edit; the next snapshot/reconcile retries.
  if (id === activeId && handlers?.isActiveDirty()) return false;

  const winner = isNewer(remote, local) ? remote : local;
  const loser = winner === remote ? local : remote;
  const fork = forkConflict(loser);
  await saveLocal(fork);
  await pushIfPossible(fork);
  await saveLocal(winner); // winner.id === id
  if (winner === local) await pushIfPossible(local); // make our version canonical in the cloud
  if (id === activeId) handlers?.applyRemoteToActive(winner);
  handlers?.notify?.(`"${stripConflictSuffix(loser.title)}" was edited on two devices — kept both as a conflict copy.`);
  return true;
}

// One-shot two-way merge run at sign-in: reconcile every remote map against local,
// then claim any local-only maps into the account (skipping blank default maps).
async function reconcile(): Promise<void> {
  if (!db || !uid) return;
  const database = db;
  const userId = uid;

  const snap = await getDocs(mapsCol(database, userId));
  const remote = new Map<string, NoteMap>();
  snap.forEach((s) => {
    const m = deserialize(s.data());
    if (m) remote.set(s.id, m);
  });

  let changed = false;
  for (const [id, rm] of remote) {
    if (await ingestRemote(id, rm)) changed = true;
  }

  // Local-only maps: claim them into the account. Blank default maps are skipped
  // so a fresh device doesn't pollute the cloud library (DC-2a).
  let claimed = 0;
  const localMetas = await activeStore.list();
  for (const lm of localMetas) {
    if (remote.has(lm.id)) continue;
    const m = await activeStore.load(lm.id);
    if (!m || isThrowawayEmpty(m)) continue;
    await pushIfPossible(m);
    claimed++;
  }

  if (changed) handlers?.onMapsChanged();
  firstSyncNoticeOnce(claimed);
}

// On the first authenticated reconcile for an account, tell the user their local
// maps were imported. Idempotent: a per-account marker means it runs at most once
// (DC-2a's "one-time, idempotent migration ... with clear user messaging").
function firstSyncNoticeOnce(claimed: number): void {
  if (!uid) return;
  let firstTime = false;
  try {
    firstTime = localStorage.getItem(migratedKey(uid)) !== "1";
  } catch {
    firstTime = false;
  }
  if (!firstTime) return;
  try {
    localStorage.setItem(migratedKey(uid), "1");
  } catch {
    /* ignore */
  }
  if (claimed > 0) {
    handlers?.notify?.(`Imported ${claimed} local map${claimed === 1 ? "" : "s"} into your account.`);
  }
}

// Live remote -> local. Our own writes echo back with identical content (and an
// equal rev), so contentHash recognises them and ingestRemote no-ops — no loop.
function subscribe(): void {
  if (!db || !uid) return;
  const database = db;
  const userId = uid;
  unsub = onSnapshot(mapsCol(database, userId), (snap) => {
    void (async () => {
      const activeId = handlers?.activeMapId() ?? null;
      let changed = false;
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id;
        if (ch.type === "removed") {
          if (id === activeId) continue; // never delete the map open under the user
          await activeStore.remove(id);
          clearBase(id);
          changed = true;
          continue;
        }
        const rm = deserialize(ch.doc.data());
        if (!rm) continue;
        if (await ingestRemote(id, rm)) changed = true;
      }
      if (changed) handlers?.onMapsChanged();
    })();
  });
}

// Push one map to Firestore, queueing it for retry if the write fails (e.g. the
// device is offline). A queued entry is kept only if nothing newer is already
// waiting, so a stale retry can't clobber a fresher edit on reconnect. On success
// the pushed content becomes the agreed base for divergence detection.
async function pushNow(database: Firestore, userId: string, map: NoteMap): Promise<void> {
  try {
    await setDoc(doc(mapsCol(database, userId), map.id), serialize(map));
    retry.delete(map.id);
    setBase(map);
  } catch (e) {
    const queued = retry.get(map.id);
    if (!queued || isNewer(map, queued)) retry.set(map.id, map);
    console.warn("sync push failed (queued for retry)", e);
  }
}

// On reconnect: flush the retry queue, then re-reconcile to pull anything we
// missed while offline.
function onOnline(): void {
  if (!db || !uid) return;
  const database = db;
  const userId = uid;
  const queued = [...retry.values()];
  retry.clear();
  for (const m of queued) void pushNow(database, userId, m);
  void reconcile().catch((e) => console.warn("reconnect reconcile failed", e));
}

// Debounced push of a single map after a local edit. Blank default maps are not
// pushed (DC-2a). No-ops when signed out.
export function pushLocalSave(map: NoteMap): void {
  if (!db || !uid) return;
  if (isThrowawayEmpty(map)) return;
  const database = db;
  const userId = uid;
  const prev = pendingPush.get(map.id);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pendingPush.delete(map.id);
    void pushNow(database, userId, map);
  }, 600);
  pendingPush.set(map.id, { map, timer });
}

// Flush every pending cloud push immediately (used on app exit). Fire-and-forget:
// on unload we can't await, but kicking the write off is strictly better than
// dropping it. No-ops when signed out.
export function flushPush(): void {
  if (!db || !uid) return;
  const database = db;
  const userId = uid;
  for (const { map, timer } of pendingPush.values()) {
    clearTimeout(timer);
    void pushNow(database, userId, map);
  }
  pendingPush.clear();
}

export function pushLocalRemove(id: string): void {
  if (!db || !uid) return;
  clearBase(id);
  void deleteDoc(doc(mapsCol(db, uid), id)).catch((e) => console.warn("sync remove failed", e));
}

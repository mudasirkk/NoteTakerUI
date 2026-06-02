// IndexedDB-backed MapStore for the browser build. localStorage (the previous web
// store) caps near 5 MB and serializes synchronously on the main thread; IndexedDB
// gives far more headroom and structured async access — which matters once maps
// carry imported transcripts. The catch: IndexedDB is async-only, so it can't be
// written during the page-unload teardown. That path uses a small *synchronous*
// localStorage mirror (writePendingWeb) that ensureReady folds back into IndexedDB
// on the next load. Methods never throw: on failure they warn and return safe
// defaults, matching the resilience of the localStorage/Tauri stores they replace.

import type { NoteMap } from "../model/types";
import { normalizeMap } from "../model/normalize";
import type { MapMeta, MapStore } from "./fileStore";

const DB_NAME = "notetaker";
const DB_VERSION = 1;
const STORE = "maps";

// localStorage keys folded into IndexedDB on first load and then cleared:
const V1_KEY = "notetaker:map:v1"; // original single-map record
const V2_KEY = "notetaker:maps:v2"; // previous web multi-map dict { [id]: NoteMap }
// Synchronous unload mirror — the freshest copy of any map edited too late for an
// async IndexedDB write. Recovered (and cleared) by ensureReady on the next load.
const PENDING_KEY = "notetaker:maps:pending"; // { [id]: NoteMap }

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbGet(id: string): Promise<NoteMap | undefined> {
  return openDB().then(
    (db) =>
      new Promise<NoteMap | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as NoteMap | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbGetAll(): Promise<NoteMap[]> {
  return openDB().then(
    (db) =>
      new Promise<NoteMap[]>((resolve, reject) => {
        const t = db.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as NoteMap[]) ?? []);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(map: NoteMap): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).put(map);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function idbDelete(id: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Higher rev wins; ties break on the ISO updatedAt string. Used so a stale unload
// mirror (e.g. from another tab) can't clobber a newer copy already in IndexedDB.
function isNewer(a: NoteMap, b: NoteMap): boolean {
  const ra = a.rev ?? 0;
  const rb = b.rev ?? 0;
  if (ra !== rb) return ra > rb;
  return (a.updatedAt ?? "") > (b.updatedAt ?? "");
}

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) ready = migrate();
  return ready;
}

// Fold any localStorage data — the legacy single map, the v2 multi-map dict, and the
// last synchronous unload mirror — into IndexedDB (newest wins), then clear it so it
// can't resurface stale. After the one-time v1/v2 import, this is just the per-load
// recovery of the pending mirror.
async function migrate(): Promise<void> {
  try {
    const incoming: Record<string, NoteMap> = {};
    const collect = (parsed: unknown) => {
      if (!parsed || typeof parsed !== "object") return;
      for (const raw of Object.values(parsed as Record<string, unknown>)) {
        const m = normalizeMap(raw);
        if (m) incoming[m.id] = m; // later sources overwrite earlier (pending = newest)
      }
    };
    const v1 = normalizeMap(safeParse(localStorage.getItem(V1_KEY)));
    if (v1) incoming[v1.id] = v1;
    collect(safeParse(localStorage.getItem(V2_KEY)));
    collect(safeParse(localStorage.getItem(PENDING_KEY)));

    const ids = Object.keys(incoming);
    if (ids.length) {
      await Promise.all(
        ids.map(async (id) => {
          const existing = await idbGet(id);
          if (!existing || isNewer(incoming[id], existing)) await idbPut(incoming[id]);
        })
      );
    }
    localStorage.removeItem(V1_KEY);
    localStorage.removeItem(V2_KEY);
    localStorage.removeItem(PENDING_KEY);
  } catch (e) {
    console.warn("idb migration failed", e);
  }
}

export const idbStore: MapStore = {
  async list(): Promise<MapMeta[]> {
    await ensureReady();
    try {
      const maps = (await idbGetAll())
        .map(normalizeMap)
        .filter((m): m is NoteMap => m !== null);
      return maps
        .map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt, rev: m.rev ?? 0 }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    } catch (e) {
      console.warn("idb list failed", e);
      return [];
    }
  },
  async load(id) {
    await ensureReady();
    try {
      const raw = await idbGet(id);
      return raw ? normalizeMap(raw) : null;
    } catch (e) {
      console.warn("idb load failed", e);
      return null;
    }
  },
  async save(map) {
    await ensureReady();
    try {
      await idbPut(map);
    } catch (e) {
      console.warn("idb save failed", e);
    }
  },
  async remove(id) {
    await ensureReady();
    try {
      await idbDelete(id);
    } catch (e) {
      console.warn("idb remove failed", e);
    }
  },
};

// Synchronous best-effort write for the unload/hide path (saveSync). IndexedDB can't
// complete during teardown, so the freshest map is mirrored into localStorage and
// recovered into IndexedDB by ensureReady on the next load.
export function writePendingWeb(map: NoteMap): void {
  try {
    const all = (safeParse(localStorage.getItem(PENDING_KEY)) as Record<string, NoteMap>) ?? {};
    all[map.id] = map;
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

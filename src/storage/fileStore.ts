// Storage abstraction. The browser build persists to localStorage; the desktop
// build writes one JSON file per map under <app-data>/maps/ (via Rust commands).
// Both sit behind the same MapStore interface and are selected at runtime.
//
// The "active map" pointer is a per-device preference, so it lives in
// localStorage in BOTH builds (the Tauri webview persists localStorage too).

import type { NoteMap } from "../model/types";
import { normalizeMap } from "../model/normalize";
import { isTauri } from "../platform/window";
import { idbStore, writePendingWeb } from "./idbStore";

export interface MapMeta {
  id: string;
  title: string;
  updatedAt: string;
  rev: number; // monotonic edit counter; sync's primary ordering key (FUN-2)
}

export interface MapStore {
  list(): Promise<MapMeta[]>;
  load(id: string): Promise<NoteMap | null>;
  save(map: NoteMap): Promise<void>;
  remove(id: string): Promise<void>;
}

const ACTIVE_KEY = "notetaker:activeMapId";

export function getActiveMapId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveMapId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

async function coreInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Fold the desktop's pre-existing single-map file into the multi-map scheme. Runs
// at most once per session and is idempotent (the legacy record is removed once
// imported), so later calls are no-ops. The browser's legacy-localStorage import
// lives in idbStore now.
let migration: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migration) migration = doMigrate();
  return migration;
}

async function doMigrate(): Promise<void> {
  if (!isTauri) return; // the browser's legacy-localStorage import lives in idbStore
  try {
    const legacy = await coreInvoke<string | null>("load_legacy_map");
    if (legacy) {
      const map = normalizeMap(JSON.parse(legacy));
      if (map) {
        await coreInvoke("save_map", { id: map.id, contents: JSON.stringify(map, null, 2) });
        await coreInvoke("delete_legacy_map");
      }
    }
  } catch (e) {
    console.warn("legacy map migration failed", e);
  }
}

export const tauriStore: MapStore = {
  async list() {
    await ensureMigrated();
    try {
      // list_maps now returns one compact metadata object per map (read from the
      // sidecar index, not the full bodies — FUN-6), so we map straight to
      // MapMeta instead of normalizing whole maps.
      const rows = await coreInvoke<string[]>("list_maps");
      const metas: MapMeta[] = [];
      for (const c of rows) {
        try {
          const m = JSON.parse(c) as Partial<MapMeta>;
          if (m && typeof m.id === "string") {
            metas.push({
              id: m.id,
              title: typeof m.title === "string" ? m.title : "Untitled",
              updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : "",
              rev: typeof m.rev === "number" ? m.rev : 0,
            });
          }
        } catch {
          /* skip a corrupt index entry rather than failing the whole list */
        }
      }
      // Most-recently-updated first.
      return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    } catch (e) {
      console.warn("list_maps failed", e);
      return [];
    }
  },
  async load(id) {
    await ensureMigrated();
    try {
      const raw = await coreInvoke<string | null>("load_map", { id });
      return raw ? normalizeMap(JSON.parse(raw)) : null;
    } catch (e) {
      console.warn("load_map failed", e);
      return null;
    }
  },
  async save(map) {
    await ensureMigrated();
    try {
      await coreInvoke("save_map", { id: map.id, contents: JSON.stringify(map, null, 2) });
    } catch (e) {
      console.warn("save_map failed", e);
    }
  },
  async remove(id) {
    await ensureMigrated();
    try {
      await coreInvoke("delete_map", { id });
    } catch (e) {
      console.warn("delete_map failed", e);
    }
  },
};

// On the desktop write real files; in the browser persist to IndexedDB.
export const activeStore: MapStore = isTauri ? tauriStore : idbStore;

// Best-effort *synchronous* save for the unload/hide path. During `beforeunload`
// or a window hide, queued microtasks (and therefore an async save) may never run
// before the page is torn down. IndexedDB can't complete a write that late either,
// so the browser mirrors the map into a synchronous localStorage pending key that
// idbStore folds back into IndexedDB on the next load. The desktop has no
// synchronous IPC, so it fires the normal async save — the Tauri close-requested
// handler awaits the async flush instead (see lifecycle.ts).
export function saveSync(map: NoteMap): void {
  if (isTauri) {
    void tauriStore.save(map);
  } else {
    writePendingWeb(map);
  }
}

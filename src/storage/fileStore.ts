// Storage abstraction. The browser build persists to localStorage; the desktop
// build writes one JSON file per map under <app-data>/maps/ (via Rust commands).
// Both sit behind the same MapStore interface and are selected at runtime.
//
// The "active map" pointer is a per-device preference, so it lives in
// localStorage in BOTH builds (the Tauri webview persists localStorage too).

import type { NoteMap } from "../model/types";
import { normalizeMap } from "../model/normalize";
import { isTauri } from "../platform/window";

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

const MAPS_KEY = "notetaker:maps:v2"; // browser: { [id]: NoteMap }
const LEGACY_KEY = "notetaker:map:v1"; // browser: the old single-map key
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

// Most-recently-updated first, so callers can default to metas[0].
function metasOf(maps: NoteMap[]): MapMeta[] {
  return maps
    .map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt, rev: m.rev ?? 0 }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function coreInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function readAllWeb(): Record<string, NoteMap> {
  try {
    const raw = localStorage.getItem(MAPS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NoteMap>) : {};
  } catch {
    return {};
  }
}

function writeAllWeb(all: Record<string, NoteMap>): void {
  try {
    localStorage.setItem(MAPS_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// Fold any pre-existing single-map storage into the new multi-map scheme. Runs
// at most once per session and is idempotent (the legacy record is removed once
// imported), so later calls are no-ops.
let migration: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migration) migration = doMigrate();
  return migration;
}

async function doMigrate(): Promise<void> {
  if (isTauri) {
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
  } else {
    try {
      const old = localStorage.getItem(LEGACY_KEY);
      if (old) {
        const map = normalizeMap(JSON.parse(old));
        if (map) {
          const all = readAllWeb();
          all[map.id] = map;
          writeAllWeb(all);
        }
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (e) {
      console.warn("legacy map migration failed", e);
    }
  }
}

export const webStore: MapStore = {
  async list() {
    await ensureMigrated();
    const maps = Object.values(readAllWeb())
      .map(normalizeMap)
      .filter((m): m is NoteMap => m !== null);
    return metasOf(maps);
  },
  async load(id) {
    await ensureMigrated();
    const raw = readAllWeb()[id];
    return raw ? normalizeMap(raw) : null;
  },
  async save(map) {
    await ensureMigrated();
    const all = readAllWeb();
    all[map.id] = map;
    writeAllWeb(all);
  },
  async remove(id) {
    await ensureMigrated();
    const all = readAllWeb();
    delete all[id];
    writeAllWeb(all);
  },
};

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
      // Most-recently-updated first, matching metasOf's ordering.
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

// On the desktop write real files; in the browser fall back to localStorage.
export const activeStore: MapStore = isTauri ? tauriStore : webStore;

// Best-effort *synchronous* save for the unload/hide path. During `beforeunload`
// or a window hide, queued microtasks (and therefore an async save) may never run
// before the page is torn down, so the browser writes localStorage directly here.
// The desktop has no synchronous IPC, so it fires the normal async save — the
// Tauri close-requested handler awaits the async flush instead (see lifecycle.ts).
export function saveSync(map: NoteMap): void {
  if (isTauri) {
    void tauriStore.save(map);
  } else {
    try {
      const all = readAllWeb();
      all[map.id] = map;
      writeAllWeb(all);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
}

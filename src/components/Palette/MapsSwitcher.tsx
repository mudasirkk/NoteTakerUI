import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useFocusTrap } from "../../keyboard/useFocusTrap";
import { activeStore, type MapMeta } from "../../storage/fileStore";

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

// Recent-maps switcher: list every saved map, open one, start a new one, or
// delete (two-click confirm). Styled with the shared palette classes.
export function MapsSwitcher() {
  const open = useStore((s) => s.mapsOpen);
  const currentId = useStore((s) => s.map.id);
  const mapsRev = useStore((s) => s.mapsRev);
  const { setMaps, switchMap, newMap, deleteMap } = useStore.getState();

  const [items, setItems] = useState<MapMeta[]>([]);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  const refresh = () => void activeStore.list().then(setItems);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setConfirmId(null);
    refresh();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Refetch when cloud sync changes the set of maps while the switcher is open.
  useEffect(() => {
    if (open) void activeStore.list().then(setItems);
  }, [mapsRev]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? items.filter((m) => m.title.toLowerCase().includes(ql)) : items;
  }, [items, q]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const onDelete = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id); // first click arms the confirm
      return;
    }
    await deleteMap(id);
    setConfirmId(null);
    refresh();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setMaps(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[idx];
      if (r) void switchMap(r.id);
    }
  };

  return (
    <div className="palscrim" onMouseDown={() => setMaps(false)}>
      <div
        className="pal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Switch map"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palin">
          <span className="arr">▤</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Switch map…"
          />
          <button className="pal-new" onClick={() => void newMap()}>
            + New
          </button>
        </div>
        <div className="pallist">
          {results.length === 0 && <div className="palempty">No maps</div>}
          {results.map((m, i) => (
            <div
              key={m.id}
              className={
                "palrow" + (i === idx ? " on" : "") + (m.id === currentId ? " current" : "")
              }
              onMouseEnter={() => setIdx(i)}
              onClick={() => void switchMap(m.id)}
            >
              <span className="ic">▤</span>
              <span className="paltxt">{m.title || "Untitled"}</span>
              <span className="pts">{relTime(m.updatedAt)}</span>
              <button
                className="pal-del"
                title="Delete map"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(m.id);
                }}
              >
                {confirmId === m.id ? "delete?" : "✕"}
              </button>
            </div>
          ))}
        </div>
        <div className="palfoot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

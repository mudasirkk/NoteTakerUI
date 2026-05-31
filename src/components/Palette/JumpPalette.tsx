import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { ancestorsOf } from "../../state/nodeOps";
import { useFocusTrap } from "../../keyboard/useFocusTrap";
import { formatTime } from "../../util/time";

export function JumpPalette() {
  const open = useStore((s) => s.paletteOpen);
  const nodes = useStore((s) => s.map.nodes);
  const { setPalette, select, expand, seekToNode } = useStore.getState();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  const results = useMemo(() => {
    const items = nodes.filter((n) => n.text.trim() !== "");
    const ql = q.trim().toLowerCase();
    const filtered = ql ? items.filter((n) => n.text.toLowerCase().includes(ql)) : items;
    return filtered.slice(0, 50);
  }, [nodes, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const choose = (id: string) => {
    ancestorsOf(nodes, id).forEach((a) => expand(a));
    select(id);
    seekToNode(id); // jump the video to this note's timestamp (no-op if it has none)
    setPalette(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setPalette(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[idx];
      if (r) choose(r.id);
    }
  };

  return (
    <div className="palscrim" onMouseDown={() => setPalette(false)}>
      <div
        className="pal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a note"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palin">
          <span className="arr">›</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a note…"
          />
        </div>
        <div className="pallist">
          {results.length === 0 && <div className="palempty">No matches</div>}
          {results.map((r, i) => (
            <div
              key={r.id}
              className={"palrow" + (i === idx ? " on" : "")}
              onMouseEnter={() => setIdx(i)}
              onClick={() => choose(r.id)}
            >
              <span className="ic">⌖</span>
              <span className="paltxt">{r.text}</span>
              {r.timestamp != null && <span className="pts">{formatTime(r.timestamp)}</span>}
            </div>
          ))}
        </div>
        <div className="palfoot">
          <span>↑↓ navigate</span>
          <span>↵ jump</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

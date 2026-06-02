import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { useStore } from "../../state/store";
import { ROW_LAYOUTS, NOTES_SIZED_LAYOUTS, type Layout } from "../../platform/layout";
import { PlayerPanel } from "../Player/PlayerPanel";

// Below this stage width a side-by-side / stacked split is too cramped to use, so
// every docked layout collapses to the bottom dock (locked decision). Focus keeps
// its floating mini at any width.
const NARROW = 720;
const PIP_MARGIN = 16; // gap from the stage edge when the mini snaps to a corner

interface Props {
  view: "outline" | "map";
  notes: ReactNode;
}

// The v2 shell. One flex container frames the note canvas beside / above / below
// the player, or floats the player as a draggable mini in focus mode. The .lay-*
// class drives direction + child order + divider axis; the sized pane's flex-basis
// is the only thing computed here, from the persisted splitRatio.
export function LayoutShell({ view, notes }: Props) {
  const layout = useStore((s) => s.layout);
  const splitRatio = useStore((s) => s.splitRatio);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const sourceType = useStore((s) => s.map.source?.type ?? "external");
  const playerVisible = useStore((s) => s.playerVisible);
  const hasVideo = sourceType === "youtube" || sourceType === "localVideo";
  // The player pane shows only when there's a video source AND the user hasn't hidden
  // it (notes-only mode). Everything below keys off showPlayer, so hiding the player
  // collapses to the same full-bleed notes stage an external source already uses.
  const showPlayer = hasVideo && playerVisible;

  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const effLayout: Layout = narrow && layout !== "focus" ? "bottom" : layout;

  const stageRef = useRef<HTMLDivElement>(null);
  const isRow = ROW_LAYOUTS.includes(effLayout);
  const notesSized = NOTES_SIZED_LAYOUTS.includes(effLayout);
  const pct = Math.round(splitRatio * 1000) / 10; // one-decimal % keeps basis stable
  const sizedStyle = { flex: `0 0 ${pct}%` };

  // Drag the divider. Pointer capture keeps tracking even over the video iframe.
  // The pointer's fraction along the stage (X for rows, Y for columns) becomes the
  // sized pane's ratio: split/top size the leading pane (ratio = frac); right,
  // bottom and theater size the trailing pane (ratio = 1 - frac).
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    const ratioAt = (ev: PointerEvent): number => {
      const rect = stage.getBoundingClientRect();
      const frac = isRow
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      return effLayout === "split" || effLayout === "top" ? frac : 1 - frac;
    };
    const move = (ev: PointerEvent) => setSplitRatio(ratioAt(ev));
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove("dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setSplitRatio(ratioAt(ev), true); // persist only on release
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const notesSection = (
    <section
      className="mw-notes body"
      id="view-panel"
      role="tabpanel"
      aria-labelledby={view === "outline" ? "tab-outline" : "tab-map"}
      style={notesSized && showPlayer ? sizedStyle : undefined}
    >
      {notes}
    </section>
  );

  // No player (external source, or the user hid it): notes fill the stage — no
  // divider, no video pane.
  if (!showPlayer) {
    return (
      <div className="mw-stage lay-solo" ref={stageRef}>
        {notesSection}
      </div>
    );
  }

  // Focus: full-bleed notes with the player floating as a draggable mini.
  if (effLayout === "focus") {
    return (
      <div className="mw-stage lay-focus" ref={stageRef}>
        {notesSection}
        <PipPlayer stageRef={stageRef} />
      </div>
    );
  }

  // Docked layouts. DOM order is always video · divider · notes; the .lay-* class
  // reorders for right/bottom. The video carries the inline basis everywhere
  // except theater, which sizes the notes rail instead.
  return (
    <div className={"mw-stage lay-" + effLayout} ref={stageRef}>
      <section className="mw-video" style={notesSized ? undefined : sizedStyle}>
        <PlayerPanel />
      </section>
      <div className="mw-div" onPointerDown={onResizeDown} title="Drag to resize" />
      {notesSection}
    </div>
  );
}

// Focus-mode mini-player. Free-drags within the stage and snaps to the nearest
// corner on release; sits above the palettes (z 55) per the locked decision. Only
// the slim top bar initiates a drag, so the video below stays clickable and a
// YouTube iframe (which swallows its own pointer events) can still be moved.
function PipPlayer({ stageRef }: { stageRef: RefObject<HTMLDivElement> }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pipRef = useRef<HTMLDivElement>(null);

  // A stage resize can leave a snapped position off-screen; re-dock to the corner.
  useEffect(() => {
    const onResize = () => setPos(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const snap = (left: number, top: number) => {
    const stage = stageRef.current;
    const pip = pipRef.current;
    if (!stage || !pip) return { left, top };
    const s = stage.getBoundingClientRect();
    const p = pip.getBoundingClientRect();
    const maxL = Math.max(PIP_MARGIN, s.width - p.width - PIP_MARGIN);
    const maxT = Math.max(PIP_MARGIN, s.height - p.height - PIP_MARGIN);
    const left2 = left + p.width / 2 < s.width / 2 ? PIP_MARGIN : maxL;
    const top2 = top + p.height / 2 < s.height / 2 ? PIP_MARGIN : maxT;
    return { left: left2, top: top2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const pip = pipRef.current;
    if (!stage || !pip) return;
    e.preventDefault();
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    pip.classList.add("dragging");
    const s = stage.getBoundingClientRect();
    const p = pip.getBoundingClientRect();
    const offX = e.clientX - p.left; // grab offset, so the pip doesn't jump
    const offY = e.clientY - p.top;
    const maxL = Math.max(0, s.width - p.width);
    const maxT = Math.max(0, s.height - p.height);
    let latest = { left: p.left - s.left, top: p.top - s.top };
    const move = (ev: PointerEvent) => {
      latest = {
        left: Math.max(0, Math.min(maxL, ev.clientX - s.left - offX)),
        top: Math.max(0, Math.min(maxT, ev.clientY - s.top - offY)),
      };
      setPos(latest);
    };
    const up = () => {
      bar.releasePointerCapture(e.pointerId);
      pip.classList.remove("dragging");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      setPos(snap(latest.left, latest.top));
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  };

  return (
    <div
      className="mw-pip"
      ref={pipRef}
      style={pos ? { left: pos.left, top: pos.top } : { right: PIP_MARGIN, bottom: PIP_MARGIN }}
    >
      <div className="mw-pip-bar" onPointerDown={onPointerDown} title="Drag to move" />
      <div className="mw-pip-grip" aria-hidden />
      <PlayerPanel />
    </div>
  );
}

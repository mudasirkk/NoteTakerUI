// Device-local layout selection for the v2 shell. Like playerHeight before it,
// this is a per-install presentation preference — one global pick, never synced
// and not stored per-map (locked decision, 2026-05-31). The store persists the
// choice through uiPrefs; this module just owns the vocabulary and the math.

export type Layout = "split" | "bottom" | "top" | "right" | "theater" | "focus";

// Cycle order for Ctrl+\ — matches the spec's gallery/playground sequence. Split
// is the wide-window default and where the cycle starts.
export const LAYOUTS: Layout[] = ["split", "bottom", "top", "right", "theater", "focus"];

export const DEFAULT_LAYOUT: Layout = "split";
export const DEFAULT_SPLIT_RATIO = 0.5;

export interface LayoutMeta {
  label: string;
  desc: string;
  icon: string; // glyph for the title-bar popover
}

export const LAYOUT_META: Record<Layout, LayoutMeta> = {
  split: { label: "Vertical split", desc: "Video left · notes right", icon: "▥" },
  bottom: { label: "Bottom dock", desc: "Player under the notes", icon: "▤" },
  top: { label: "Top dock", desc: "Video above, notes beneath", icon: "⬓" },
  right: { label: "Right rail", desc: "Notes lead · video on the right", icon: "▦" },
  theater: { label: "Theater", desc: "Video fills · notes on a slim rail", icon: "▭" },
  focus: { label: "Focus + mini", desc: "Full-bleed notes · floating video", icon: "◳" },
};

// Row (horizontal) layouts resize along X; the rest resize along Y. Focus/solo
// have no divider.
export const ROW_LAYOUTS: Layout[] = ["split", "right", "theater"];

// Theater sizes the *notes* rail (video fills); every other split sizes the
// *video* pane (notes take the rest). The shell uses this to decide which pane
// carries the inline flex-basis and how to translate a drag into a ratio.
export const NOTES_SIZED_LAYOUTS: Layout[] = ["theater"];

// Clamp the shared splitRatio into a sane band for the active layout: a slim rail
// for theater's notes, a generous range for everyone else.
export function clampRatio(layout: Layout, ratio: number): number {
  const [lo, hi] = layout === "theater" ? [0.18, 0.45] : [0.2, 0.8];
  return Math.min(hi, Math.max(lo, ratio));
}

// Step through LAYOUTS with wraparound (Ctrl+\ forward, Ctrl+Shift+\ back).
export function nextLayout(current: Layout, dir: 1 | -1): Layout {
  const n = LAYOUTS.length;
  const i = LAYOUTS.indexOf(current);
  return LAYOUTS[((((i === -1 ? 0 : i) + dir) % n) + n) % n];
}

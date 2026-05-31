import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useFocusTrap } from "../../keyboard/useFocusTrap";
import { importTranscriptFile } from "../../transcript/import";

type Cmd = {
  id: string;
  title: string;
  hint?: string;
  arg?: { placeholder: string };
  run: (arg?: string) => void;
};

const COLORS = [
  { name: "Red", value: "#d6451f" },
  { name: "Amber", value: "#b08524" },
  { name: "Teal", value: "#1f5e5b" },
  { name: "Slate", value: "#5b6470" },
];

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  const view = useStore((s) => s.view);
  const autoStamp = useStore((s) => s.autoStamp);
  const zoomRootId = useStore((s) => s.zoomRootId);
  const selectedId = useStore((s) => s.selectedId);
  const transcriptOpen = useStore((s) => s.transcriptOpen);
  const hasTranscript = useStore((s) => (s.map.transcript?.length ?? 0) > 0);
  const pinned = useStore((s) => s.pinned);

  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [argFor, setArgFor] = useState<Cmd | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  const close = () => useStore.getState().setCommand(false);

  const commands = useMemo<Cmd[]>(() => {
    const st = useStore.getState();
    const withSel = (fn: (id: string) => void) => () => {
      const id = useStore.getState().selectedId;
      if (id) fn(id);
    };
    return [
      {
        id: "view",
        title: view === "outline" ? "Switch to Map view" : "Switch to Outline view",
        hint: "Ctrl+M",
        run: () => st.toggleView(),
      },
      { id: "switchMap", title: "Switch map…", hint: "Ctrl+O", run: () => st.setMaps(true) },
      { id: "newMap", title: "New map", run: () => void st.newMap() },
      {
        id: "yt",
        title: "Set YouTube source…",
        arg: { placeholder: "YouTube URL or video ID" },
        run: (a) => a && st.setSource({ type: "youtube", url: a, label: "YouTube" }),
      },
      { id: "local", title: "Open local video file…", run: () => void st.openLocalVideo() },
      {
        id: "external",
        title: "Use external source (session timer)",
        run: () => st.setSource({ type: "external", label: "Lecture" }),
      },
      { id: "autostamp", title: `Auto-stamp: turn ${autoStamp ? "off" : "on"}`, run: () => st.toggleAutoStamp() },
      { id: "stamp", title: "Stamp current note now", hint: "Ctrl+T", run: withSel((id) => st.stamp(id)) },
      {
        id: "delete-subtree",
        title: "Delete note & children",
        hint: "Ctrl+⇧⌫",
        run: () => {
          const id = useStore.getState().selectedId;
          if (!id) return;
          const hasKids = useStore.getState().map.nodes.some((n) => n.parentId === id);
          if (!hasKids || window.confirm("Delete this note and all its children?")) st.deleteSubtree(id);
        },
      },
      { id: "reset", title: "Reset session timer", run: () => st.resetSession() },
      { id: "collapseAll", title: "Collapse all", run: () => st.collapseAll() },
      { id: "expandAll", title: "Expand all", run: () => st.expandAll() },
      { id: "zoomIn", title: "Zoom into current note", hint: "Ctrl+]", run: () => st.zoomIn() },
      ...(zoomRootId
        ? [{ id: "zoomOut", title: "Zoom out", hint: "Ctrl+[", run: () => st.zoomOut() } as Cmd]
        : []),
      {
        id: "tag",
        title: "Add tag to current note…",
        arg: { placeholder: "tag name" },
        run: (a) => {
          const id = useStore.getState().selectedId;
          if (a && id) st.addTag(id, a);
        },
      },
      ...COLORS.map(
        (c): Cmd => ({ id: "color-" + c.value, title: `Color: ${c.name}`, run: withSel((id) => st.setColor(id, c.value)) })
      ),
      { id: "color-none", title: "Color: clear", run: withSel((id) => st.setColor(id, undefined)) },
      {
        id: "transcript-import",
        title: "Import transcript (.srt/.vtt)…",
        run: () =>
          void importTranscriptFile().then((cues) => {
            if (cues && cues.length) st.setTranscript(cues);
          }),
      },
      {
        id: "transcript-toggle",
        title: transcriptOpen ? "Hide transcript panel" : "Show transcript panel",
        run: () => st.setTranscriptOpen(!useStore.getState().transcriptOpen),
      },
      ...(hasTranscript
        ? [{ id: "transcript-clear", title: "Clear transcript", run: () => st.clearTranscript() } as Cmd]
        : []),
      {
        id: "pin",
        title: pinned ? "Unpin window (turn off always-on-top)" : "Pin window on top",
        run: () => st.togglePin(),
      },
      { id: "theme-system", title: "Theme: System (match OS)", run: () => st.setTheme("system") },
      { id: "theme-light", title: "Theme: Light", run: () => st.setTheme("light") },
      { id: "theme-dark", title: "Theme: Dark", run: () => st.setTheme("dark") },
      { id: "help", title: "Keyboard shortcuts", hint: "?", run: () => st.setHelp(true) },
      { id: "save", title: "Save now", hint: "Ctrl+S", run: () => st.save() },
      { id: "export-md", title: "Export to Markdown…", run: () => void st.exportMarkdown() },
    ];
  }, [view, autoStamp, zoomRootId, selectedId, transcriptOpen, hasTranscript, pinned]);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? commands.filter((c) => c.title.toLowerCase().includes(ql)) : commands;
  }, [commands, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setArgFor(null);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const runCmd = (c: Cmd) => {
    if (c.arg) {
      setArgFor(c);
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    c.run();
    close();
  };

  const submitArg = () => {
    if (!argFor) return;
    argFor.run(q.trim());
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (argFor) {
        setArgFor(null);
        setQ("");
      } else {
        close();
      }
      return;
    }
    if (argFor) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitArg();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = results[idx];
      if (c) runCmd(c);
    }
  };

  return (
    <div className="palscrim" onMouseDown={close}>
      <div
        className="pal cmd"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palin">
          <span className="arr">{argFor ? "✎" : "⌘"}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={argFor ? argFor.arg!.placeholder : "Type a command…"}
          />
        </div>
        {!argFor && (
          <div className="pallist">
            {results.length === 0 && <div className="palempty">No commands</div>}
            {results.map((c, i) => (
              <div
                key={c.id}
                className={"palrow" + (i === idx ? " on" : "")}
                onMouseEnter={() => setIdx(i)}
                onClick={() => runCmd(c)}
              >
                <span className="ic">›</span>
                <span className="paltxt">{c.title}</span>
                {c.hint && <span className="cmdhint">{c.hint}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="palfoot">
          {argFor ? (
            <>
              <span>↵ apply</span>
              <span>esc back</span>
            </>
          ) : (
            <>
              <span>↑↓ navigate</span>
              <span>↵ run</span>
              <span>esc close</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

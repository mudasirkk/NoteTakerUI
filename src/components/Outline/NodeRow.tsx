import { useEffect, useRef } from "react";
import type { NoteNode } from "../../model/types";
import { useStore } from "../../state/store";
import { nextVisibleId, prevVisibleId } from "../../state/nodeOps";
import { formatTime } from "../../util/time";

interface Props {
  node: NoteNode;
  depth: number;
  hasChildren: boolean;
}

export function NodeRow({ node, depth, hasChildren }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const selected = useStore((s) => s.selectedId === node.id);
  const canSeek = useStore((s) => s.controller.canSeek);
  const {
    setText,
    addSibling,
    indent,
    outdent,
    move,
    removeIfEmpty,
    toggleCollapse,
    select,
    seekToNode,
    removeTag,
  } = useStore.getState();

  // Focus the textarea when this row becomes the selection.
  useEffect(() => {
    if (selected && ref.current && document.activeElement !== ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [selected]);

  // Auto-grow with content.
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [node.text]);

  const grow = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = ref.current!;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addSibling(node.id);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.shiftKey ? outdent(node.id) : indent(node.id);
      return;
    }
    if (e.key === "Backspace" && el.value === "") {
      e.preventDefault();
      removeIfEmpty(node.id);
      return;
    }
    if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(node.id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    // Plain arrows move between notes only when the caret is at the edge line.
    if (e.key === "ArrowUp" && !mod) {
      const before = el.value.slice(0, el.selectionStart);
      if (!before.includes("\n")) {
        const st = useStore.getState();
        const p = prevVisibleId(st.map.nodes, node.id, st.zoomRootId);
        if (p) {
          e.preventDefault();
          select(p);
        }
      }
      return;
    }
    if (e.key === "ArrowDown" && !mod) {
      const after = el.value.slice(el.selectionEnd);
      if (!after.includes("\n")) {
        const st = useStore.getState();
        const n = nextVisibleId(st.map.nodes, node.id, st.zoomRootId);
        if (n) {
          e.preventDefault();
          select(n);
        }
      }
      return;
    }
  };

  const rowStyle: React.CSSProperties = { paddingLeft: 8 + depth * 22 };
  if (node.color && !selected) rowStyle.boxShadow = `inset 2px 0 0 ${node.color}`;

  return (
    <div className={"row" + (selected ? " sel" : "")} style={rowStyle}>
      <button
        className={"fold" + (hasChildren ? "" : " leaf")}
        onClick={() => hasChildren && toggleCollapse(node.id)}
        tabIndex={-1}
        aria-label={hasChildren ? (node.collapsed ? "Expand" : "Collapse") : undefined}
      >
        {hasChildren ? (node.collapsed ? "▸" : "▾") : ""}
      </button>
      <span
        className={"bullet" + (node.collapsed && hasChildren ? " has" : "")}
        style={node.color && !selected ? { background: node.color } : undefined}
      />
      <textarea
        ref={ref}
        className="nodeinput"
        rows={1}
        value={node.text}
        placeholder={node.text === "" ? "New note…" : ""}
        onChange={(e) => {
          setText(node.id, e.target.value);
          grow();
        }}
        onFocus={() => select(node.id)}
        onKeyDown={onKeyDown}
      />
      {node.tags.length > 0 && (
        <div className="tags">
          {node.tags.map((t) => (
            <button
              key={t}
              className="tag"
              tabIndex={-1}
              title="Remove tag"
              onClick={() => removeTag(node.id, t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      {node.timestamp != null && (
        <button
          className={"ts" + (canSeek ? " seekable" : "")}
          tabIndex={-1}
          title={canSeek ? "Jump to this moment" : "Timestamp — this source can't seek"}
          onClick={() => {
            select(node.id);
            seekToNode(node.id);
          }}
        >
          {formatTime(node.timestamp)}
        </button>
      )}
    </div>
  );
}

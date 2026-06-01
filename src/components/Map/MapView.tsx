import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import { useStore } from "../../state/store";
import { visibleRows } from "../../state/nodeOps";
import { formatTime } from "../../util/time";

const NODE_W = 188;
const NODE_H = 48;

type NoteData = {
  text: string;
  timestamp: number | null;
  hasChildren: boolean;
  collapsed: boolean;
  selected: boolean;
  canSeek: boolean;
  color?: string;
};
type NoteFlowNodeT = Node<NoteData, "note">;

function NoteFlowNode({ data }: NodeProps<NoteFlowNodeT>) {
  return (
    <div
      className={
        "mapnode" +
        (data.selected ? " sel" : "") +
        (data.collapsed && data.hasChildren ? " collapsed" : "")
      }
      style={data.color ? { borderLeftColor: data.color } : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className="mapnode-text">{data.text || "Untitled"}</div>
      {(data.timestamp != null || (data.collapsed && data.hasChildren)) && (
        <div className="mapnode-foot">
          {data.timestamp != null && (
            <span className={"mapnode-ts" + (data.canSeek ? " seekable" : "")}>
              {formatTime(data.timestamp)}
            </span>
          )}
          {data.collapsed && data.hasChildren && <span className="mapnode-more">+ hidden</span>}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { note: NoteFlowNode };

// Freeform cross-link edge (UX-6). A wide transparent overlay path thickens the
// hit-area so the thin dashed line is easy to grab, and an ✕ control fades in on
// hover to make removal discoverable (clicking the line still works too, via the
// canvas-level onEdgeClick handler).
function LinkEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style } = props;
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={"link-del" + (hover ? " on" : "")}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().removeLink(id.slice(5));
          }}
          title="Remove link"
          aria-label="Remove link"
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { link: LinkEdge };

// Left-to-right tree layout via dagre.
function laidOut(nodes: NoteFlowNodeT[], edges: Edge[]): NoteFlowNodeT[] {
  const g = new graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 48, marginx: 12, marginy: 12 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagreLayout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
  });
}

export function MapView() {
  const allNodes = useStore((s) => s.map.nodes);
  const links = useStore((s) => s.map.links);
  const selectedId = useStore((s) => s.selectedId);
  const canSeek = useStore((s) => s.controller.canSeek);

  const { nodes, edges } = useMemo(() => {
    const rows = visibleRows(allNodes); // respects collapse, like the outline
    const visibleIds = new Set(rows.map((r) => r.node.id));
    const rfNodes: NoteFlowNodeT[] = rows.map((r) => ({
      id: r.node.id,
      type: "note",
      position: { x: 0, y: 0 },
      data: {
        text: r.node.text,
        timestamp: r.node.timestamp,
        hasChildren: r.hasChildren,
        collapsed: r.node.collapsed,
        selected: r.node.id === selectedId,
        canSeek,
        color: r.node.color,
      },
    }));
    // Hierarchy edges drive the dagre layout.
    const hierEdges: Edge[] = [];
    for (const r of rows) {
      const pid = r.node.parentId;
      if (pid && visibleIds.has(pid)) {
        hierEdges.push({ id: pid + "->" + r.node.id, source: pid, target: r.node.id, type: "smoothstep" });
      }
    }
    const laid = laidOut(rfNodes, hierEdges);
    // Freeform cross-links are drawn on top but kept OUT of dagre so they can't
    // distort the tree layout (or introduce cycles). Only show links whose both
    // endpoints are currently visible.
    const linkEdges: Edge[] = (links ?? [])
      .filter((l) => visibleIds.has(l.from) && visibleIds.has(l.to))
      .map((l) => ({
        id: "link:" + l.id,
        source: l.from,
        target: l.to,
        type: "link",
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#9d8cff" },
        style: { stroke: "#9d8cff", strokeDasharray: "5 4" },
      }));
    return { nodes: laid, edges: [...hierEdges, ...linkEdges] };
  }, [allNodes, links, selectedId, canSeek]);

  // Re-fit the graph whenever the canvas resizes (window resize, the player
  // divider moving, or entering/leaving map fullscreen).
  const rfRef = useRef<ReactFlowInstance<NoteFlowNodeT, Edge> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 150 }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Fullscreen map: blow the canvas up to fill the whole window; Esc to exit.
  const [fs, setFs] = useState(false);
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFs(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);

  if (nodes.length === 0) {
    return (
      <div className="map-placeholder">
        <p>No notes yet — capture some in the outline, then switch back here to review.</p>
      </div>
    );
  }

  // Surface the linking affordance only while it's actionable and undiscovered:
  // at least two notes exist and the user hasn't drawn a cross-link yet (UX-6).
  const showLinkHint = nodes.length >= 2 && (links?.length ?? 0) === 0;

  return (
    <div className={"mapwrap" + (fs ? " fs" : "")} ref={wrapRef}>
      <ReactFlow<NoteFlowNodeT>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        onNodeClick={(_, n) => {
          const st = useStore.getState();
          st.select(n.id);
          st.seekToNode(n.id);
        }}
        onConnect={(c: Connection) => {
          if (c.source && c.target) useStore.getState().addLink(c.source, c.target);
        }}
        onEdgeClick={(_, edge) => {
          // Hierarchy edges aren't removable; cross-links (id "link:…") are.
          if (edge.id.startsWith("link:")) useStore.getState().removeLink(edge.id.slice(5));
        }}
        fitView
        nodesDraggable={false}
        nodesConnectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
      >
        <Background gap={20} size={1} color="rgba(127,140,160,0.12)" />
        <Controls showInteractive={false}>
          <ControlButton onClick={() => setFs((v) => !v)} title={fs ? "Exit fullscreen (Esc)" : "Fullscreen map"}>
            {fs ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M5 1v4H1M11 5H7V1M7 11V7h4M1 7h4v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </ControlButton>
        </Controls>
      </ReactFlow>
      {showLinkHint && (
        <div className="maphint" role="note">
          <span className="maphint-dot" aria-hidden />
          Hover a node and drag from its edge dot to another to link them. Hover a link to remove it.
        </div>
      )}
    </div>
  );
}

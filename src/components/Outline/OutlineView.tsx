import { useStore } from "../../state/store";
import { visibleRows, ancestorsOf } from "../../state/nodeOps";
import { NodeRow } from "./NodeRow";

export function OutlineView() {
  const nodes = useStore((s) => s.map.nodes);
  const zoomRootId = useStore((s) => s.zoomRootId);
  const setZoom = useStore((s) => s.setZoom);

  const zoomRoot = zoomRootId ? nodes.find((n) => n.id === zoomRootId) : null;
  const rows = visibleRows(nodes, zoomRoot ? zoomRoot.id : null);

  return (
    <div className="outline">
      {zoomRoot && (
        <nav className="crumbs">
          <button className="crumb" onClick={() => setZoom(null)}>
            All
          </button>
          {ancestorsOf(nodes, zoomRoot.id)
            .reverse()
            .map((aid) => {
              const a = nodes.find((n) => n.id === aid);
              return a ? (
                <span key={aid} className="crumb-wrap">
                  <span className="crumb-sep">›</span>
                  <button className="crumb" onClick={() => setZoom(aid)}>
                    {a.text || "Untitled"}
                  </button>
                </span>
              ) : null;
            })}
          <span className="crumb-sep">›</span>
          <span className="crumb cur">{zoomRoot.text || "Untitled"}</span>
        </nav>
      )}
      {rows.map((r) => (
        <NodeRow key={r.node.id} node={r.node} depth={r.depth} hasChildren={r.hasChildren} />
      ))}
      {rows.length === 0 && zoomRoot && (
        <div className="zoom-empty">
          No child notes here.{" "}
          <button onClick={() => setZoom(null)}>Zoom out</button>
        </div>
      )}
    </div>
  );
}

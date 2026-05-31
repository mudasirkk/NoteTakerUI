// Pure tree operations over a flat NoteNode[] (parentId + order model).
// Every function returns a NEW array; callers own state.

import type { NoteNode } from "../model/types";

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export function childrenOf(nodes: NoteNode[], parentId: string | null): NoteNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

export interface VisibleRow {
  node: NoteNode;
  depth: number;
  hasChildren: boolean;
}

// Depth-first list of visible rows, respecting `collapsed`. When `rootId` is
// given, only that node's subtree is listed (used by zoom-into-node).
export function visibleRows(nodes: NoteNode[], rootId: string | null = null): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(nodes, parentId)) {
      const hasChildren = childrenOf(nodes, n.id).length > 0;
      rows.push({ node: n, depth, hasChildren });
      if (!n.collapsed) walk(n.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}

// Reassign contiguous order indices within one sibling group.
function renumber(nodes: NoteNode[], parentId: string | null): NoteNode[] {
  const ids = childrenOf(nodes, parentId).map((n) => n.id);
  return nodes.map((n) => {
    const i = ids.indexOf(n.id);
    return i === -1 ? n : { ...n, order: i };
  });
}

export function makeNode(
  parentId: string | null,
  order: number,
  timestamp: number | null
): NoteNode {
  return { id: newId(), parentId, order, text: "", timestamp, collapsed: false, tags: [] };
}

export function insertSiblingAfter(
  nodes: NoteNode[],
  refId: string,
  timestamp: number | null
): { nodes: NoteNode[]; id: string } {
  const ref = nodes.find((n) => n.id === refId);
  if (!ref) {
    const n = makeNode(null, childrenOf(nodes, null).length, timestamp);
    return { nodes: [...nodes, n], id: n.id };
  }
  const node = makeNode(ref.parentId, ref.order + 1, timestamp);
  let next = nodes.map((n) =>
    n.parentId === ref.parentId && n.order > ref.order ? { ...n, order: n.order + 1 } : n
  );
  next = renumber([...next, node], ref.parentId);
  return { nodes: next, id: node.id };
}

// Make node a child of its previous sibling.
export function indent(nodes: NoteNode[], id: string): NoteNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return nodes;
  const sibs = childrenOf(nodes, node.parentId);
  const idx = sibs.findIndex((s) => s.id === id);
  if (idx <= 0) return nodes; // no previous sibling to nest under
  const prev = sibs[idx - 1];
  const newOrder = childrenOf(nodes, prev.id).length;
  let next = nodes.map((n) =>
    n.id === id
      ? { ...n, parentId: prev.id, order: newOrder }
      : n.id === prev.id
        ? { ...n, collapsed: false }
        : n
  );
  next = renumber(next, node.parentId);
  return next;
}

// Make node a sibling of its parent, placed right after the parent.
export function outdent(nodes: NoteNode[], id: string): NoteNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node || node.parentId === null) return nodes;
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return nodes;
  const grandParent = parent.parentId;
  let next = nodes.map((n) =>
    n.parentId === grandParent && n.order > parent.order ? { ...n, order: n.order + 1 } : n
  );
  next = next.map((n) =>
    n.id === id ? { ...n, parentId: grandParent, order: parent.order + 1 } : n
  );
  next = renumber(next, node.parentId);
  next = renumber(next, grandParent);
  return next;
}

export function moveWithinSiblings(
  nodes: NoteNode[],
  id: string,
  dir: -1 | 1
): NoteNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return nodes;
  const sibs = childrenOf(nodes, node.parentId);
  const idx = sibs.findIndex((s) => s.id === id);
  const swap = idx + dir;
  if (swap < 0 || swap >= sibs.length) return nodes;
  const a = sibs[idx];
  const b = sibs[swap];
  return nodes.map((n) =>
    n.id === a.id ? { ...n, order: b.order } : n.id === b.id ? { ...n, order: a.order } : n
  );
}

export function descendantsOf(nodes: NoteNode[], id: string): Set<string> {
  const set = new Set<string>();
  const walk = (pid: string) => {
    for (const c of childrenOf(nodes, pid)) {
      set.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return set;
}

export function deleteNode(nodes: NoteNode[], id: string): NoteNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return nodes;
  const kill = descendantsOf(nodes, id);
  kill.add(id);
  return renumber(
    nodes.filter((n) => !kill.has(n.id)),
    node.parentId
  );
}

export function setCollapsed(
  nodes: NoteNode[],
  id: string,
  collapsed: boolean
): NoteNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, collapsed } : n));
}

export function prevVisibleId(
  nodes: NoteNode[],
  id: string,
  rootId: string | null = null
): string | null {
  const rows = visibleRows(nodes, rootId);
  const i = rows.findIndex((r) => r.node.id === id);
  return i > 0 ? rows[i - 1].node.id : null;
}

export function nextVisibleId(
  nodes: NoteNode[],
  id: string,
  rootId: string | null = null
): string | null {
  const rows = visibleRows(nodes, rootId);
  const i = rows.findIndex((r) => r.node.id === id);
  return i >= 0 && i < rows.length - 1 ? rows[i + 1].node.id : null;
}

export function ancestorsOf(nodes: NoteNode[], id: string): string[] {
  const res: string[] = [];
  let cur = nodes.find((n) => n.id === id);
  while (cur && cur.parentId) {
    res.push(cur.parentId);
    const pid: string = cur.parentId;
    cur = nodes.find((n) => n.id === pid);
  }
  return res;
}

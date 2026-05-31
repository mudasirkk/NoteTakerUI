// Convert a NoteMap into Obsidian-friendly Markdown: a nested bullet list,
// timestamps rendered as click-to-seek links when the source is a YouTube
// video, and tags as #hashtags (which Obsidian indexes natively).

import type { NoteMap, NoteNode } from "../model/types";
import { childrenOf } from "../state/nodeOps";
import { formatTime } from "../util/time";
import { parseYouTubeId } from "../player/youtubeApi";

function youtubeSeekLink(map: NoteMap, seconds: number): string | null {
  if (map.source?.type !== "youtube" || !map.source.url) return null;
  const id = parseYouTubeId(map.source.url);
  return id ? `https://youtu.be/${id}?t=${seconds}` : null;
}

// A node is skippable only if it is an empty leaf — an empty parent still has
// to render so its children stay nested correctly.
function isEmptyLeaf(map: NoteMap, node: NoteNode): boolean {
  return node.text.trim() === "" && childrenOf(map.nodes, node.id).length === 0;
}

function nodeLine(map: NoteMap, node: NoteNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const parts = [node.text.trim() || "(untitled)"];
  if (node.timestamp != null) {
    const label = formatTime(node.timestamp);
    const link = youtubeSeekLink(map, node.timestamp);
    parts.push(link ? `[${label}](${link})` : `(${label})`);
  }
  for (const tag of node.tags) parts.push(`#${tag}`);
  return `${indent}- ${parts.join(" ")}`;
}

export function mapToMarkdown(map: NoteMap): string {
  const lines: string[] = [`# ${map.title.trim() || "Untitled lecture"}`, ""];

  if (map.source) {
    if (map.source.type === "youtube" && map.source.url) {
      const id = parseYouTubeId(map.source.url);
      const url = id ? `https://youtu.be/${id}` : map.source.url;
      lines.push(`Source: [${map.source.label ?? "YouTube"}](${url})`, "");
    } else if (map.source.label) {
      lines.push(`Source: ${map.source.label}`, "");
    }
  }

  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(map.nodes, parentId)) {
      if (!isEmptyLeaf(map, n)) lines.push(nodeLine(map, n, depth));
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  const links = map.links ?? [];
  if (links.length) {
    const textOf = (id: string) =>
      map.nodes.find((n) => n.id === id)?.text.trim() || "(untitled)";
    lines.push("", "## Links", "");
    for (const l of links) lines.push(`- ${textOf(l.from)} → ${textOf(l.to)}`);
  }

  return lines.join("\n") + "\n";
}

// A filesystem-safe default filename derived from the map title.
export function suggestedFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "notes"}.md`;
}

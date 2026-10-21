/**
 * Blame: one node's or one edge's own history (designs/2026-10-19-business-map.md, "History like
 * git"). Pure: the versions in, the lines out.
 */
import { canonicalJson } from "./diff.js";
import type { BlameLine } from "./history.js";
import type { ShapeBody } from "./model.js";

/** What `historyOf` reads of each version. */
export interface BlameVersion {
  number: number;
  body: ShapeBody;
  note: string;
  createdBy: string;
  createdAt: Date | string;
}

/**
 * Every version that added, removed, renamed or changed node `id` (or edge `id` with `on` "edge"),
 * with who, when and why, newest first. Each version is compared with the one before it in
 * number order; the first version that holds the id added it.
 */
export function historyOf(
  versions: readonly BlameVersion[],
  id: string,
  on: "node" | "edge" = "node",
): BlameLine[] {
  const sorted = [...versions].sort((x, y) => x.number - y.number);
  const perVersion: BlameLine[][] = [];
  let before: ShapeBody = { name: "", nodes: [], edges: [] };
  for (const v of sorted) {
    const lines: BlameLine[] = [];
    const line = (how: BlameLine["how"], rename?: { from: string; to: string }): void => {
      lines.push({
        version: v.number,
        how,
        ...(rename ?? {}),
        note: v.note,
        by: v.createdBy,
        at: isoOf(v.createdAt),
      });
    };
    if (on === "node") {
      const was = before.nodes.find((n) => n.id === id);
      const now = v.body.nodes.find((n) => n.id === id);
      if (!was && now) line("added");
      else if (was && !now) line("removed");
      else if (was && now) {
        if (was.name !== now.name) line("renamed", { from: was.name, to: now.name });
        if (canonicalJson({ ...was, name: "" }) !== canonicalJson({ ...now, name: "" }))
          line("changed");
      }
    } else {
      const was = before.edges.find((e) => e.id === id);
      const now = v.body.edges.find((e) => e.id === id);
      if (!was && now) line("added");
      else if (was && !now) line("removed");
      else if (was && now && canonicalJson(was) !== canonicalJson(now)) line("changed");
    }
    perVersion.push(lines);
    before = v.body;
  }
  return perVersion.reverse().flat();
}

/** ISO text of a Date or of a time already written as text. */
export function isoOf(at: Date | string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? String(at) : d.toISOString();
}

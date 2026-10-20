/**
 * Blame: one node's or one edge's own history (designs/2026-10-19-business-map.md, "History like
 * git"). Pure: the versions in, the lines out.
 */
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
  _versions: readonly BlameVersion[],
  _id: string,
  _on: "node" | "edge" = "node",
): BlameLine[] {
  throw new Error("historyOf: not built yet (brief 2026-10-20-shape-git-3)");
}

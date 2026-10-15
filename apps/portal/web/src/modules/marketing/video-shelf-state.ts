/** The Videos shelf's reads, kept apart from the page so they test without a browser. */
import type { Piece } from "@wren/content/pieces";
import type { TagTone } from "@wren/ui";

export type ShelfRow = {
  /** A record id: a string on the wire. */
  id: string | number;
  title: string;
  state: string;
  render: string | null;
  cut: string;
  shorts: number;
};

/** A card's state, in his words: what the video needs, or where it is. */
export function shelfState(
  r: Pick<ShelfRow, "state" | "render">,
  posted: boolean,
): { label: string; tone: TagTone } {
  if (r.render === "failed") return { label: "Render failed", tone: "warn" };
  if (r.render === "waiting" || r.render === "rendering")
    return { label: "Rendering", tone: "neutral" };
  if (r.state === "failed") return { label: "Upload failed", tone: "warn" };
  if (r.state === "uploaded" || posted) return { label: "Posted", tone: "green" };
  if (r.state === "approved") return { label: "Approved", tone: "green" };
  if (r.state === "rendered") return { label: "Waiting on you", tone: "accent" };
  return { label: "Editing", tone: "neutral" };
}

/** Where a recording went: the platforms its posts are live on, each once. */
export function wentTo(piece: Piece | undefined): string[] {
  if (!piece) return [];
  const all = [piece, ...piece.children];
  const out = new Set<string>();
  for (const p of all)
    for (const b of p.branches)
      if (b.state === "live" && b.platform !== "editor" && b.platform !== "site")
        out.add(b.platform);
  return [...out];
}

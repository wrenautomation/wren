/**
 * What a page shows, for the agent's next turn (designs/2026-11-11-agent-panel.md, D3 A): each
 * source (the shared list, a record, a selection, a page's own) publishes one part while mounted.
 * One store, no provider: the panel sits outside the page's tree.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { SeenPart } from "./agent-sees.js";

export type SeenSource = "record" | "selection" | "list" | "page";

/** Joined in this order: the most specific first. */
const ORDER: readonly SeenSource[] = ["record", "selection", "list", "page"];

/** Rows a list part carries; the rest are counted. Keeps a turn near 3 KB. */
export const SEEN_ROWS = 50;

let parts: readonly SeenPart[] = [];
const subs = new Set<() => void>();
const sub = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const put = (id: SeenSource, part: Omit<SeenPart, "id"> | null) => {
  const rest = parts.filter((p) => p.id !== id);
  const next = part ? [...rest, { ...part, id }] : rest;
  parts = next.sort(
    (a, b) => ORDER.indexOf(a.id as SeenSource) - ORDER.indexOf(b.id as SeenSource),
  );
  for (const f of subs) f();
};

/** Publish a part while mounted; undefined publishes nothing. */
export function useSeen(
  source: SeenSource,
  part: Omit<SeenPart, "id" | "off"> | null | undefined,
): void {
  const key = part ? `${part.label}\n${part.icon}\n${part.text}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the part's content
  useEffect(() => {
    if (!part) return;
    const mine = { ...part };
    put(source, mine);
    return () => {
      // a newer publish of the same source owns it now
      const now = parts.find((p) => p.id === source);
      if (now && now.text === mine.text && now.label === mine.label) put(source, null);
    };
  }, [source, key]);
}

/** Every part in view, in order. */
export const useSeenParts = (): readonly SeenPart[] =>
  useSyncExternalStore(
    sub,
    () => parts,
    () => parts,
  );

/** Rows as lines: the first `SEEN_ROWS`, then a count of the rest. */
export function seenRows(rows: readonly string[], total = rows.length): string {
  const shown = rows.slice(0, SEEN_ROWS);
  const more = total - shown.length;
  return more > 0 ? `${shown.join("\n")}\n…and ${more} more` : shown.join("\n");
}

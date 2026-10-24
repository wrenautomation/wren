/**
 * What one viewer keeps of the Map in this browser: the fold depth, the folds opened by hand and
 * the open panel. They stay when the viewer leaves the Map and comes back. Pure parsing; the
 * browser store is `../local.ts`. A bad or missing value reads as nothing.
 */
import type { OpenMap } from "@wren/ui/metro";
import { keep, recall } from "../local.js";
import type { PanelRef } from "./routes.js";

export interface Kept {
  depth?: number;
  open?: OpenMap;
  panel?: PanelRef | null;
}

/** One key for each workspace: a client's Map keeps its own view. */
export const keptKey = (client: string): string => `map:view:${client}`;

const KINDS = ["station", "track", "line"];

/** The kept view in `raw`, or an empty one. Reads only what it knows. */
export function keptOf(raw: string | null): Kept {
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Kept = {};
  // A view kept before the depth tree (10-23) named its depth `level`.
  const depth = o.depth ?? o.level;
  if (typeof depth === "number" && Number.isInteger(depth) && depth >= 0) out.depth = depth;
  if (o.open && typeof o.open === "object") {
    const open: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(o.open)) if (typeof b === "boolean") open[k] = b;
    out.open = open;
  }
  const p = o.panel as Record<string, unknown> | null | undefined;
  if (p && typeof p.id === "string" && p.id && KINDS.includes(String(p.kind)))
    out.panel = { kind: p.kind as PanelRef["kind"], id: p.id };
  return out;
}

export const recallView = (client: string): Kept => keptOf(recall(keptKey(client)));

/** Keep `part` of the view; the rest stays as it was. */
export function keepView(client: string, part: Kept): void {
  keep(keptKey(client), JSON.stringify({ ...recallView(client), ...part }));
}

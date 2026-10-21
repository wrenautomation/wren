/**
 * The live shape's nodes, read light (the shape alone, no numbers): for Admin → Systems and for
 * ⌘K's stations. Both read the one portal call, so the answer is shared and kept.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import type { ShapeBody, ShapeNode } from "@wren/pipeline/model";
import type { PaletteItem } from "@wren/ui";
import { call } from "../api.js";
import { readCall, useCall } from "../load.js";
import { WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { mapNodeHref } from "./routes.js";

const key = (client: string) => `shape-nodes:${client}`;

async function readNodes(client: string): Promise<ShapeNode[]> {
  const got = await call<RecordAnswer>("pipeline/recordsGet", {
    ...atOf(client),
    record: "pipeline.shape",
    id: "shape",
  });
  return (got.detail as { body?: ShapeBody } | null)?.body?.nodes ?? [];
}

/** The workspace's shape nodes; none for a workspace with no shape. */
export const useShapeNodes = (client: string) => useCall(key(client), () => readNodes(client));

/** ⌘K's stations: the nodes whose name or id has the typed words, each opening on the Map. */
export async function stationItems(client: string, words: string): Promise<PaletteItem[]> {
  const q = words.trim().toLowerCase();
  if (!q) return [];
  const nodes = await readCall(key(client), () => readNodes(client), 60_000);
  return nodes
    .filter((n) => !("parked" in n && n.parked) && `${n.name} ${n.id}`.toLowerCase().includes(q))
    .map((n) => ({
      label: n.name,
      group: "Stations",
      href: mapNodeHref(n.id, client === WREN.id ? null : client),
      icon: "workflow" as const,
      hint: n.kind,
    }));
}

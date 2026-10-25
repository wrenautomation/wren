/**
 * The live shape, read light (the shape alone, no numbers): the graph nodes for Admin → Systems
 * (an app is found by a node's `via` and `channel`) and the metro stations for ⌘K. Both read the
 * one portal call, so the answer is shared and kept.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import type { MetroBody, MetroLine, MetroStation } from "@wren/pipeline/metro";
import type { ShapeBody, ShapeNode } from "@wren/pipeline/model";
import type { PaletteItem } from "@wren/ui";
import { call } from "../api.js";
import { readCall, useCall } from "../load.js";
import { WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { focusHref } from "./focus.js";

const key = (client: string) => `shape-nodes:${client}`;

/** The shape's graph nodes and its metro stations. Both empty for a workspace with no shape. */
interface ShapeParts {
  nodes: ShapeNode[];
  stations: MetroStation[];
  /** The metro lines: an offer line has the tier `core`, an offer and a colour. */
  lines: MetroLine[];
}

async function readShape(client: string): Promise<ShapeParts> {
  const got = await call<RecordAnswer>("pipeline/recordsGet", {
    ...atOf(client),
    record: "pipeline.shape",
    id: "shape",
  });
  const detail = got.detail as { body?: ShapeBody; metro?: MetroBody | null } | null;
  return {
    nodes: detail?.body?.nodes ?? [],
    stations: detail?.metro?.stations ?? [],
    lines: detail?.metro?.lines ?? [],
  };
}

/** The workspace's shape parts; none for a workspace with no shape. */
export const useShapeNodes = (client: string) => useCall(key(client), () => readShape(client));

/** The shape's offer lines (a line with an offer and a colour): Studio's line chips and squares. */
export const offerLinesOf = (lines: readonly MetroLine[] | undefined): MetroLine[] =>
  (lines ?? []).filter((l) => l.tier === "core");

/** ⌘K's stations: the metro stations whose label or id has the typed words, each opening its focus page. */
export async function stationItems(client: string, words: string): Promise<PaletteItem[]> {
  const q = words.trim().toLowerCase();
  if (!q) return [];
  const { stations } = await readCall(key(client), () => readShape(client), 60_000);
  return stations
    .filter((s) => `${s.label} ${s.id}`.toLowerCase().includes(q))
    .map((s) => ({
      label: s.label,
      group: "Stations",
      href: focusHref(
        { kind: "station", id: s.id },
        new URLSearchParams(client === WREN.id ? {} : { client }),
      ),
      icon: "workflow" as const,
      hint: s.kind,
    }));
}

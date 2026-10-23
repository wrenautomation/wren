/**
 * A part of a metro body: a line, a group, a station or a shared flow, named by kind and id
 * (designs/2026-10-23-focus-view.md). A saved view is a set of parts. The portal's focus page and
 * `wren shape view show` read a part through these. Pure.
 */
import type { Attach, MetroBody, MetroStation } from "./metro.js";

export const PART_KINDS = ["line", "group", "station", "flow"] as const;
export type PartKind = (typeof PART_KINDS)[number];

export interface Part {
  kind: PartKind;
  id: string;
}

/** What a part holds: its name, its stations in body order, its own attachments (none on a flow). */
export interface PartRead {
  part: Part;
  label: string;
  stations: MetroStation[];
  /** Null on a flow: a flow holds no attach list. */
  attach: readonly Attach[] | null;
}

/** The part as the body holds it, or null when the body has no such part. */
export function readPart(body: MetroBody, part: Part): PartRead | null {
  switch (part.kind) {
    case "line": {
      const l = body.lines.find((x) => x.id === part.id);
      if (!l) return null;
      const stations = body.stations.filter((s) => s.line === l.id);
      return { part, label: l.label, stations, attach: l.attach ?? [] };
    }
    case "group": {
      const g = body.groups.find((x) => x.id === part.id);
      if (!g) return null;
      const stations = body.stations.filter((s) => g.stations.includes(s.id));
      return { part, label: g.label, stations, attach: g.attach ?? [] };
    }
    case "station": {
      const s = body.stations.find((x) => x.id === part.id);
      return s ? { part, label: s.label, stations: [s], attach: s.attach ?? [] } : null;
    }
    case "flow": {
      const f = body.flows?.find((x) => x.id === part.id);
      return f ? { part, label: f.label, stations: f.stations, attach: null } : null;
    }
  }
}

const isKind = (k: string): k is PartKind => (PART_KINDS as readonly string[]).includes(k);

/** A set of parts as one string: `line:growth,group:talk`. Each id is URI-encoded. */
export const partsParam = (parts: readonly Part[]): string =>
  parts.map((p) => `${p.kind}:${encodeURIComponent(p.id)}`).join(",");

/** The parts a `partsParam` string names, in order, each once. A bad entry is left out. */
export function partsOf(text: string | null | undefined): Part[] {
  const out: Part[] = [];
  for (const entry of (text ?? "").split(",")) {
    const at = entry.indexOf(":");
    const kind = entry.slice(0, at);
    let id: string;
    try {
      id = decodeURIComponent(entry.slice(at + 1));
    } catch {
      continue;
    }
    if (at < 1 || !id || !isKind(kind)) continue;
    if (!out.some((p) => p.kind === kind && p.id === id)) out.push({ kind, id });
  }
  return out;
}

/** The record a saved view of the map lives under, in `saved_views`; its params hold `parts`. */
export const MAP_VIEW_RECORD = "map";

/**
 * A focus page's model (designs/2026-10-23-focus-view.md, F1): what `/map/<kind>/<id>` names, read
 * from the metro body. Pure: the crumbs back up, the attachments of the part and of each station
 * inside it, the station ids its people and numbers come from.
 */
import type { Attach, MetroBody, MetroStation } from "@wren/pipeline/metro";
import { num } from "@wren/ui";
import type { MetroPart } from "@wren/ui/metro";
import { href, type Params } from "../route.js";
import { lineSays, type MapData, stationSays } from "./model.js";

export const PART_KINDS = ["line", "group", "station", "flow"] as const;

/** The part an address names: `/map/<kind>/<id>`. Null for any other path. */
export function partOfPath(path: readonly string[]): MetroPart | null {
  const [first, kind, id, ...rest] = path;
  if (first !== "map" || !id || rest.length) return null;
  return (PART_KINDS as readonly string[]).includes(kind ?? "")
    ? { kind: kind as MetroPart["kind"], id }
    : null;
}

/** The address of a part, keeping only the window and the workspace of `keep`. */
export function focusHref(part: MetroPart | null, keep: URLSearchParams): string {
  const params: Params = { window: keep.get("window"), client: keep.get("client") };
  const path = part ? `/map/${part.kind}/${encodeURIComponent(part.id)}` : "/";
  return href(path, params);
}

export interface Crumb {
  label: string;
  /** Null for the Map itself. */
  part: MetroPart | null;
}

/** One station's attachments, under its name. */
export interface StationAttach {
  id: string;
  label: string;
  attach: readonly Attach[];
}

export interface Focus {
  part: MetroPart;
  name: string;
  /** What the part is, in one word. */
  word: string;
  /** Map first, the part last. */
  crumbs: Crumb[];
  /** The crumb Esc goes to: the one before the part. */
  up: Crumb;
  /** The part's own list; null on a flow, which holds no attach list. */
  own: readonly Attach[] | null;
  /** Each station inside with an attachment, in body order. */
  inside: StationAttach[];
  /** Every station inside, in body order. */
  stations: MetroStation[];
}

const WORD = { line: "Line", group: "Group", station: "Station", flow: "Shared flow" } as const;

/** The focus of a part, or null when the body does not hold it. */
export function focusOf(metro: MetroBody, part: MetroPart): Focus | null {
  const map: Crumb = { label: "Map", part: null };
  const lineCrumb = (id: string | undefined): Crumb[] => {
    const l = metro.lines.find((x) => x.id === id);
    return l ? [{ label: l.label, part: { kind: "line", id: l.id } }] : [];
  };
  const make = (
    name: string,
    own: readonly Attach[] | null,
    stations: MetroStation[],
    above: Crumb[],
  ): Focus => {
    const crumbs = [map, ...above, { label: name, part }];
    return {
      part,
      name,
      word: WORD[part.kind],
      crumbs,
      up: crumbs.at(-2) ?? map,
      own,
      stations,
      inside: stations.flatMap((s) =>
        s.attach?.length && !(part.kind === "station" && s.id === part.id)
          ? [{ id: s.id, label: s.label, attach: s.attach }]
          : [],
      ),
    };
  };
  switch (part.kind) {
    case "line": {
      const l = metro.lines.find((x) => x.id === part.id);
      if (!l) return null;
      return make(
        l.label,
        l.attach ?? [],
        metro.stations.filter((s) => s.line === l.id),
        [],
      );
    }
    case "group": {
      const g = metro.groups.find((x) => x.id === part.id);
      if (!g) return null;
      const stations = metro.stations.filter((s) => g.stations.includes(s.id));
      return make(g.label, g.attach ?? [], stations, lineCrumb(g.line));
    }
    case "station": {
      const s = metro.stations.find((x) => x.id === part.id);
      if (!s) return null;
      const g = metro.groups.find((x) => x.stations.includes(s.id));
      const group: Crumb[] = g ? [{ label: g.label, part: { kind: "group", id: g.id } }] : [];
      return make(s.label, s.attach ?? [], [s], [...lineCrumb(s.line), ...group]);
    }
    case "flow": {
      const f = metro.flows?.find((x) => x.id === part.id);
      if (!f) return null;
      return make(f.label, null, f.stations, []);
    }
  }
}

/** The part's numbers over the window: a station's or a line's own, or the sum of its stations'. */
export function focusNumbers(data: MapData, focus: Focus): string[] {
  const { part } = focus;
  if (part.kind === "station")
    return stationSays(focus.stations[0]?.kind ?? "att", data.stations.get(part.id));
  const sum = (key: "now" | "arrived" | "left") =>
    focus.stations.reduce((n, s) => n + (data.stations.get(s.id)?.[key] ?? 0), 0);
  const flow = [
    `Now: ${num(sum("now"))}`,
    `Arrived: ${num(sum("arrived"))}`,
    `Left: ${num(sum("left"))}`,
  ];
  if (part.kind === "line") {
    const own = lineSays(data.lines.get(part.id));
    return own[0] === "No numbers yet." ? flow : [...flow, ...own];
  }
  return flow;
}

/** The people on the part now, newest move first (the order `data.people` keeps). */
export const focusPeople = (data: MapData, focus: Focus) => {
  const ids = new Set(focus.stations.map((s) => s.id));
  return data.people.filter((p) => ids.has(p.node));
};

/** Where an attachment opens: a URL as it is, an SOP in the Library, else nowhere. */
export function attachHref(a: Attach): string | null {
  if (/^https:\/\//.test(a.ref)) return a.ref;
  if (a.kind === "sop") return `/library/sops/${encodeURIComponent(a.ref)}`;
  return null;
}

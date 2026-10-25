/**
 * A focus page's model (designs/2026-10-23-focus-view.md, F1 and F2): what `/map/<kind>/<id>`,
 * `/map/parts/<parts>` and `/map/view/<id>` name, read from the metro body. Pure: the crumbs back
 * up, the attachments of each part and of each station inside, the station ids its people and
 * numbers come from.
 */
import type { Attach, MetroBody, MetroStation } from "@wren/pipeline/metro";
import { PART_KINDS, partsOf, partsParam, readPart } from "@wren/pipeline/metro-parts";
import { num } from "@wren/ui";
import type { MetroPart } from "@wren/ui/metro";
import { href, type Params } from "../route.js";
import { lineSays, type MapData, stationSays } from "./model.js";

/** What a focus address names: one part, a set of parts, or a saved view by its id. */
export type FocusAt = { parts: MetroPart[] } | { view: number };

/** The focus an address names: `/map/<kind>/<id>`, `/map/parts/<parts>`, `/map/view/<id>`. */
export function focusAtOf(path: readonly string[]): FocusAt | null {
  const [first, kind, id, ...rest] = path;
  if (first !== "map" || !id || rest.length) return null;
  if (kind === "view") return /^[1-9]\d*$/.test(id) ? { view: Number(id) } : null;
  if (kind === "parts") {
    const parts = partsOf(id);
    return parts.length ? { parts } : null;
  }
  return (PART_KINDS as readonly string[]).includes(kind ?? "")
    ? { parts: [{ kind: kind as MetroPart["kind"], id }] }
    : null;
}

/** A key for what an address names, the same for one part however it is written. */
export const focusKey = (at: FocusAt) =>
  "view" in at ? `view:${at.view}` : at.parts.map((p) => `${p.kind}:${p.id}`).join(",");

/** The address of a focus, keeping only the window and the workspace of `keep`, and `more`. Null is the Map. */
export function focusHref(
  to: MetroPart | readonly MetroPart[] | { view: number } | null,
  keep: URLSearchParams,
  more: Params = {},
): string {
  const params: Params = { window: keep.get("window"), client: keep.get("client"), ...more };
  const parts = !to || "view" in to ? [] : "kind" in to ? [to] : to;
  const path =
    to && "view" in to
      ? `/map/view/${to.view}`
      : parts.length === 1 && parts[0]
        ? `/map/${parts[0].kind}/${encodeURIComponent(parts[0].id)}`
        : parts.length
          ? `/map/parts/${encodeURIComponent(partsParam(parts))}`
          : "/";
  return href(path, params);
}

export interface Crumb {
  label: string;
  /** Null for the Map itself, and for a set, which has no address of its own. */
  part: MetroPart | null;
}

/** One part's attachments, under its name: a part of a set, or a station inside. */
interface PartAttach {
  part: MetroPart;
  label: string;
  attach: readonly Attach[];
}

export interface Focus {
  /** The one part on screen; null for a set, which holds no attach list of its own. */
  part: MetroPart | null;
  /** Each part on screen that the body holds. */
  parts: MetroPart[];
  name: string;
  /** What the focus is, in one word. */
  word: string;
  /** Map first, the focus last. */
  crumbs: Crumb[];
  /** The crumb Esc goes to: the one before the focus. */
  up: Crumb;
  /** The part's own list; null on a flow and on a set. */
  own: readonly Attach[] | null;
  /** Each part of a set, then each station inside, with an attachment, in body order. */
  inside: PartAttach[];
  /** Every station inside, in body order, each once. */
  stations: MetroStation[];
}

const WORD = { line: "Line", group: "Group", station: "Station", flow: "Shared flow" } as const;
const MAP: Crumb = { label: "Map", part: null };

const stationAttach = (stations: readonly MetroStation[], skip: (id: string) => boolean) =>
  stations.flatMap((s): PartAttach[] =>
    s.attach?.length && !skip(s.id)
      ? [{ part: { kind: "station", id: s.id }, label: s.label, attach: s.attach }]
      : [],
  );

/**
 * The focus of one part, or of a set of parts under `name` (a saved view). Null when the body
 * holds none of them; a set draws the parts it still holds.
 */
export function focusOf(
  metro: MetroBody,
  parts: readonly MetroPart[],
  name?: string,
): Focus | null {
  const reads = parts.flatMap((p) => readPart(metro, p) ?? []);
  const [one] = reads;
  if (!one) return null;
  if (reads.length === 1 && parts.length === 1 && name === undefined) {
    const { part, label, stations, attach } = one;
    const crumbs = [MAP, ...aboveOf(metro, part), { label, part }];
    return {
      part,
      parts: [part],
      name: label,
      word: WORD[part.kind],
      crumbs,
      up: crumbs.at(-2) ?? MAP,
      own: attach,
      stations,
      inside: stationAttach(stations, (id) => part.kind === "station" && id === part.id),
    };
  }
  const title = name ?? reads.map((r) => r.label).join(" + ");
  const seen = new Set<string>();
  const stations = reads
    .flatMap((r) => r.stations)
    .filter((s) => !seen.has(s.id) && !!seen.add(s.id));
  const own = (k: string) => reads.some((r) => r.part.kind === "station" && r.part.id === k);
  return {
    part: null,
    parts: reads.map((r) => r.part),
    name: title,
    word: "View",
    crumbs: [MAP, { label: title, part: null }],
    up: MAP,
    own: null,
    stations,
    inside: [
      ...reads.flatMap((r): PartAttach[] =>
        r.attach?.length ? [{ part: r.part, label: r.label, attach: r.attach }] : [],
      ),
      ...stationAttach(stations, own),
    ],
  };
}

/** The crumbs between the Map and a part: a group's line, a station's line and group. */
function aboveOf(metro: MetroBody, part: MetroPart): Crumb[] {
  const lineCrumb = (id: string | undefined): Crumb[] => {
    const l = metro.lines.find((x) => x.id === id);
    return l ? [{ label: l.label, part: { kind: "line", id: l.id } }] : [];
  };
  if (part.kind === "group") return lineCrumb(metro.groups.find((g) => g.id === part.id)?.line);
  if (part.kind !== "station") return [];
  const s = metro.stations.find((x) => x.id === part.id);
  const g = metro.groups.find((x) => x.stations.includes(part.id));
  return [
    ...lineCrumb(s?.line),
    ...(g ? [{ label: g.label, part: { kind: "group" as const, id: g.id } }] : []),
  ];
}

/** The numbers over the window: a station's or a line's own, or the sum of the stations'. */
export function focusNumbers(data: MapData, focus: Focus): string[] {
  const { part } = focus;
  if (part?.kind === "station")
    return stationSays(focus.stations[0]?.kind ?? "att", data.stations.get(part.id));
  const sum = (key: "now" | "arrived" | "left") =>
    focus.stations.reduce((n, s) => n + (data.stations.get(s.id)?.[key] ?? 0), 0);
  const flow = [
    `Now: ${num(sum("now"))}`,
    `Arrived: ${num(sum("arrived"))}`,
    `Left: ${num(sum("left"))}`,
  ];
  if (part?.kind === "line") {
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

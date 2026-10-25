/**
 * The Map's drawing as plain data, pure: the stored metro body plus the window's numbers and the
 * open journeys, as the `MetroView` that `MetroMap` draws. The body gives lines, stations, tracks,
 * groups and columns. Numbers give the line under a station. `waitsOf` (tasks.ts) says which person
 * track is late, so one rule says what late is. A diff gives marks, and the older side gives back
 * what was removed, so one map shows the whole diff.
 */

import type {
  MetroLine as BodyLine,
  MetroStation as BodyStation,
  MetroTrack as BodyTrack,
  MetroBody,
} from "@wren/pipeline/metro";
import type { MetroDiff } from "@wren/pipeline/metro-diff";
import {
  ACTION_GLYPH,
  type MetroView,
  type ViewKind,
  type ViewLine,
  type ViewStation,
  type ViewTrack,
} from "@wren/ui/metro";
import type { NodeNumbers, Person } from "./model.js";
import { waitsOf } from "./tasks.js";

/** The mark of each id in a diff: added or changed (a rename is a change). */
type Marks = Map<string, "added" | "changed">;

/** The window's numbers `viewOf` reads: the stations' rows by station id. */
interface ViewNumbers {
  stations: ReadonlyMap<string, NodeNumbers>;
}

/** The kind the drawing knows: the body's `condition` is `dec`, `approval` is `ok`, a plan is `plan`. */
export function kindOf(s: Pick<BodyStation, "kind" | "planned">): ViewKind {
  if (s.planned) return "plan";
  if (s.kind === "condition") return "dec";
  if (s.kind === "approval") return "ok";
  return s.kind;
}

/** "marketing" is "Marketing": the body names a column in lower case, the drawing in title case. */
export const columnOf = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1);

const days = (n: number): string => String(Math.round(n * 10) / 10);

function marksOf(part: MetroDiff["lines"] | undefined): Marks {
  const m: Marks = new Map();
  if (!part) return m;
  for (const id of part.added) m.set(id, "added");
  for (const id of part.changed) m.set(id, "changed");
  for (const r of part.renamed) m.set(r.id, "changed");
  return m;
}

const lineOf = (l: BodyLine, mark?: "added" | "changed" | "removed"): ViewLine => ({
  id: l.id,
  ...(l.label ? { label: l.label } : {}),
  ...(l.offer !== undefined ? { offer: l.offer } : {}),
  tier: l.tier,
  ...(l.colour !== undefined ? { colour: l.colour } : {}),
  ...(l.planned ? { plan: true } : {}),
  ...(mark ? { mark } : {}),
});

function stationOf(
  s: BodyStation,
  numbers: ViewNumbers,
  group: string | undefined,
  mark?: "added" | "changed" | "removed",
): ViewStation {
  const x = numbers.stations.get(s.id);
  const sub =
    s.kind === "hub"
      ? x?.now != null
        ? `${x.now.toLocaleString("en-US")} ${x.now === 1 ? "lead" : "leads"}`
        : undefined
      : x && x.now != null && x.medianDays != null
        ? `${x.now} now · ${days(x.medianDays)} d`
        : undefined;
  return {
    id: s.id,
    kind: kindOf(s),
    line: s.line ?? "",
    column: columnOf(s.column),
    ...(group ? { group } : {}),
    ...(s.flow ? { flow: s.flow } : {}),
    label: s.label,
    ...(s.action && ACTION_GLYPH[s.action] ? { icon: ACTION_GLYPH[s.action] } : {}),
    ...(sub ? { sub } : {}),
    ...(x?.now != null && s.kind !== "hub" ? { now: x.now } : {}),
    ...(x?.arrived != null && s.kind !== "hub" ? { arrived: x.arrived } : {}),
    ...(s.failure ? { bad: true } : {}),
    ...(s.rule ? { rule: s.rule } : {}),
    ...(s.retries ? { repeat: `retry · up to ${s.retries}` } : {}),
    ...(s.template ? { template: s.template } : {}),
    ...(s.platform ? { platform: s.platform } : {}),
    ...(mark ? { mark } : {}),
  };
}

function trackOf(
  t: BodyTrack,
  to: BodyStation | undefined,
  people: readonly Person[],
  now: Date,
  mark?: "added" | "changed" | "removed",
): ViewTrack {
  const label = t.cond ?? t.label;
  const late = t.by === "person" && waitsOf(t, people, now).late;
  return {
    id: t.id,
    from: t.from,
    to: t.to,
    by: t.by,
    ...(t.owner ? { owner: t.owner } : {}),
    ...(t.promise ? { promise: t.promise } : {}),
    ...(late ? { late: true } : {}),
    ...(label ? { label } : {}),
    ...(t.by === "person" && t.owner && to ? { task: to.label } : {}),
    ...(t.planned ? { plan: true } : {}),
    ...(t.kind === "back" ? { back: true } : {}),
    ...(mark ? { mark } : {}),
  };
}

/**
 * The view of a metro body. `marks` puts a mark on each added or changed line, station and track.
 * `removed` is the older body: each line, station and track the diff says is gone is drawn again
 * with the mark `removed`, so the diff shows in one map.
 */
export function viewOf(
  metro: MetroBody,
  numbers: ViewNumbers,
  people: readonly Person[],
  now: Date,
  marks?: MetroDiff | null,
  removed?: MetroBody | null,
): MetroView {
  const mark = {
    lines: marksOf(marks?.lines),
    stations: marksOf(marks?.stations),
    tracks: marksOf(marks?.tracks),
  };
  const groupOf = new Map<string, string>();
  for (const g of metro.groups) for (const id of g.stations) groupOf.set(id, g.id);
  const stationBy = new Map(metro.stations.map((s) => [s.id, s] as const));

  const lines = metro.lines.map((l) => lineOf(l, mark.lines.get(l.id)));
  const stations = metro.stations.map((s) =>
    stationOf(s, numbers, groupOf.get(s.id), mark.stations.get(s.id)),
  );
  const tracks = metro.tracks.map((t) =>
    trackOf(t, stationBy.get(t.to), people, now, mark.tracks.get(t.id)),
  );

  if (removed && marks) {
    // Lines first: a removed station may sit on a removed line.
    const gone = (ids: string[]) => new Set(ids);
    const lineIds = gone(marks.lines.removed);
    const stationIds = gone(marks.stations.removed);
    const trackIds = gone(marks.tracks.removed);
    const have = {
      lines: new Set(lines.map((l) => l.id)),
      stations: new Set(stations.map((s) => s.id)),
      tracks: new Set(tracks.map((t) => t.id)),
    };
    for (const l of removed.lines)
      if (lineIds.has(l.id) && !have.lines.has(l.id)) lines.push(lineOf(l, "removed"));
    const oldStation = new Map(removed.stations.map((s) => [s.id, s] as const));
    for (const s of removed.stations)
      if (stationIds.has(s.id) && !have.stations.has(s.id))
        stations.push(stationOf(s, { stations: new Map() }, undefined, "removed"));
    for (const t of removed.tracks)
      if (trackIds.has(t.id) && !have.tracks.has(t.id))
        tracks.push(trackOf(t, oldStation.get(t.to) ?? stationBy.get(t.to), [], now, "removed"));
  }

  return {
    title: metro.name,
    lines,
    stations,
    tracks,
    groups: metro.groups.map((g) => ({
      id: g.id,
      label: g.label,
      ...(g.parent ? { parent: g.parent } : {}),
    })),
  };
}

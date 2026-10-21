/**
 * Undo one change of a metro body (designs/2026-10-20-design-language.md, area C1): the twin of
 * `undoChange` in `edit.ts`. Pure; refused (`Refused`) when the newest body no longer holds what
 * `b` had for that line. The caller runs `checkMetro` on the result. A flow is undone as a whole:
 * a change to a station or track inside it is `changed` on the flow, and undo puts back the flow
 * as `a` had it.
 */
import { canonicalJson } from "./diff.js";
import type { MetroBody, MetroFlow, MetroGroup, MetroStation, MetroTrack } from "./metro.js";
import {
  diffMetro,
  isNamed,
  METRO_LISTS,
  METRO_WORD,
  type MetroChange,
  type MetroOn,
  metroChangeKey,
  metroChangesOf,
  metroNameOf,
} from "./metro-diff.js";
import { Refused } from "./refused.js";

type Row = { id: string; label?: string };

const rows = (body: MetroBody, on: MetroOn): Row[] => body[METRO_LISTS[on]] ?? [];

/**
 * The body with list `on` replaced. Any other list stays as it is. The flows list is optional:
 * when it ends up empty the key goes, so a body with no flows is the body it was before.
 */
function withRows(body: MetroBody, on: MetroOn, next: Row[]): MetroBody {
  if (on !== "flow") return { ...body, [METRO_LISTS[on]]: next } as unknown as MetroBody;
  const { flows: _, ...rest } = body;
  return next.length > 0 ? { ...rest, flows: next as MetroFlow[] } : rest;
}

/** The flows these stations link to: the `flow` of each link station. */
const linksOf = (stations: readonly MetroStation[]): string[] =>
  stations.flatMap((s) => (s.kind === "link" && s.flow !== undefined ? [s.flow] : []));

const sameJson = (x: unknown, y: unknown): boolean => canonicalJson(x) === canonicalJson(y);
const withoutLabel = (r: Row): Row => ({ ...r, label: "" });
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The body without station `id`, every track that touches it, its place in a group and in a
 * frame. A group or a frame left with no station goes too, and so does a frame that exits there.
 */
export function withoutStation(body: MetroBody, id: string): MetroBody {
  /** The members of a group or a frame without `id`; null when none are left. */
  const left = (stations: string[]): string[] | null => {
    const rest = stations.filter((s) => s !== id);
    return rest.length > 0 ? rest : null;
  };
  return {
    ...body,
    stations: body.stations.filter((s) => s.id !== id),
    tracks: body.tracks.filter((t) => t.from !== id && t.to !== id),
    groups: body.groups.flatMap((g) => {
      if (!g.stations.includes(id)) return [g];
      const stations = left(g.stations);
      return stations ? [{ ...g, stations }] : [];
    }),
    frames: body.frames.flatMap((f) => {
      if (f.exit === id) return [];
      if (!f.stations.includes(id)) return [f];
      const stations = left(f.stations);
      return stations ? [{ ...f, stations }] : [];
    }),
  };
}

/**
 * The inverse of one change from version `a` to version `b`, applied to `newest`. Refused when
 * the change is not between `a` and `b`, when the newest body changed that line again, when an id
 * is taken, or when something the line points at is gone.
 */
export function undoMetroChange(
  newest: MetroBody,
  a: MetroBody,
  b: MetroBody,
  change: MetroChange,
): MetroBody {
  const key = metroChangeKey(change);
  if (!metroChangesOf(diffMetro(a, b)).some((c) => metroChangeKey(c) === key))
    throw new Refused(["That change is not between these versions."]);
  const later = (what: string) => new Refused([`${what} Undo the later change first.`]);
  const notBetween = () => new Refused(["That change is not between these versions."]);

  if (change.on === "name") {
    if (newest.name !== b.name)
      throw later(`The shape is now called ${newest.name}, not ${b.name}.`);
    return { ...newest, name: a.name };
  }

  const { on, id, how } = change;
  const find = (body: MetroBody) => rows(body, on).find((r) => r.id === id);
  const was = find(a);
  const then = find(b);
  const now = find(newest);
  /** Any item's name, from the newest body first, then b, then a. */
  const nameOf = (of: MetroOn, of_id: string) => metroNameOf([newest, b, a], of, of_id);
  const name = nameOf(on, id);
  const who = `${cap(METRO_WORD[on])} ${name}`;
  const gone = () => new Refused([`${who} is not in the shape any more.`]);
  const replace = (next: Row): MetroBody =>
    withRows(
      newest,
      on,
      rows(newest, on).map((r) => (r.id === id ? next : r)),
    );

  if (how === "added") {
    if (!now) throw gone();
    if (!isNamed(on) && !sameJson(now, then)) throw later(`${who} was changed again.`);
    if (on === "station") return withoutStation(newest, id);
    if (on === "line") {
      const holds = [
        ...newest.stations.filter((s) => s.line === id).map((s) => `station ${s.label}`),
        ...newest.tracks.filter((t) => t.line === id).map((t) => `track ${nameOf("track", t.id)}`),
        ...newest.tracks
          .filter((t) => t.entries?.includes(id))
          .map((t) => `track ${nameOf("track", t.id)}, which names it in entries`),
        ...newest.groups.filter((g) => g.line === id).map((g) => `group ${g.label}`),
      ];
      if (holds.length)
        throw new Refused(
          holds.map((h) => `${who} still holds ${h}. Undo the later change first.`),
        );
    }
    if (on === "flow") {
      const holds = [
        ...newest.stations.filter((s) => s.flow === id).map((s) => `station ${s.label}`),
        ...(newest.flows ?? []).flatMap((f) =>
          f.stations
            .filter((s) => s.flow === id)
            .map((s) => `station ${s.label} of flow ${f.label}`),
        ),
      ];
      if (holds.length)
        throw new Refused(
          holds.map((h) => `${who} is still linked by ${h}. Undo the later change first.`),
        );
    }
    return withRows(
      newest,
      on,
      rows(newest, on).filter((r) => r.id !== id),
    );
  }

  if (how === "removed") {
    if (now) throw later(`${who} is in the shape again.`);
    if (!was) throw notBetween();
    const lineIds = new Set(newest.lines.map((l) => l.id));
    const stationIds = new Set(newest.stations.map((s) => s.id));
    const flowIds = new Set((newest.flows ?? []).map((f) => f.id));
    const missing: Array<[MetroOn, string]> = [];
    const need = (of: MetroOn, ids: Array<string | undefined>, have: Set<string>) => {
      for (const x of ids) if (x !== undefined && !have.has(x)) missing.push([of, x]);
    };
    if (on === "station") {
      need("line", [(was as MetroStation).line], lineIds);
      need("flow", linksOf([was as MetroStation]), flowIds);
    }
    if (on === "track") {
      const t = was as MetroTrack;
      need("station", [t.from, t.to], stationIds);
      need("line", [t.line, ...(t.entries ?? [])], lineIds);
    }
    if (on === "group") {
      const g = was as MetroGroup;
      need("line", [g.line], lineIds);
      need("station", g.stations, stationIds);
    }
    if (on === "frame") {
      const f = was as unknown as { stations: string[]; exit: string };
      need("station", [...f.stations, f.exit], stationIds);
    }
    if (on === "flow") need("flow", linksOf((was as MetroFlow).stations), flowIds);
    if (missing.length)
      throw new Refused(
        missing.map(
          ([of, x]) =>
            `${who} needs ${METRO_WORD[of]} ${nameOf(of, x)}, which is not in the shape.`,
        ),
      );

    if (on !== "station") return withRows(newest, on, [...rows(newest, on), was]);

    // A station comes back with its tracks, and into its old group.
    const ends = new Set([...stationIds, id]);
    const taken = new Set(newest.tracks.map((t) => t.id));
    const tracks = a.tracks.filter(
      (t) =>
        (t.from === id || t.to === id) &&
        ends.has(t.from) &&
        ends.has(t.to) &&
        !taken.has(t.id) &&
        (t.line === undefined || lineIds.has(t.line)) &&
        (t.entries ?? []).every((e) => lineIds.has(e)),
    );
    const old = a.groups.find((g) => g.stations.includes(id));
    return {
      ...newest,
      stations: [...newest.stations, was as MetroStation],
      tracks: [...newest.tracks, ...tracks],
      groups: newest.groups.map((g) => {
        if (!old || g.id !== old.id || g.stations.includes(id)) return g;
        const at = Math.min(old.stations.indexOf(id), g.stations.length);
        return { ...g, stations: [...g.stations.slice(0, at), id, ...g.stations.slice(at)] };
      }),
    };
  }

  if (!was || !then) throw notBetween();
  if (!now) throw gone();
  if (how === "renamed") {
    if (now.label !== then.label)
      throw later(`${cap(METRO_WORD[on])} ${then.label} is now called ${now.label}.`);
    return replace({ ...now, label: was.label as string });
  }
  // changed: for a named item, every field but the label.
  if (isNamed(on)) {
    if (!sameJson(withoutLabel(now), withoutLabel(then))) throw later(`${who} was changed again.`);
    return replace({ ...was, label: now.label as string });
  }
  if (!sameJson(now, then)) throw later(`${who} was changed again.`);
  return replace(was);
}

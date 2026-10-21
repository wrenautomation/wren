/**
 * Today's tasks, pure (designs/2026-10-20-design-language.md, artifact section 07). Every person
 * track of the metro body is a task: its owner acts, the people at its from-station wait. The
 * Map's `late` mark (D3a) asks `waitsOf` too, so one rule says what late is.
 */
import type { MetroBody, MetroTrack } from "@wren/pipeline/metro";
import type { Person } from "./model.js";

export interface Task {
  /** The track id. */
  id: string;
  /** The to-station's label: what the owner does. */
  name: string;
  owner: string;
  /** Initials from the owner, for the avatar. */
  initials: string;
  /** The line the track sits on, and its name. */
  line: string;
  lineName: string;
  /** The from-station's label. */
  at: string;
  /** People waiting now: open journeys at the from-station. */
  waiting: number;
  /** Median hours waited, null with none. */
  medianHours: number | null;
  promise: string | null;
  /** Hours in the promise, null with none. */
  promiseHours: number | null;
  /** True when any person has waited longer than the promise. */
  late: boolean;
}

const HOURS = { m: 1 / 60, h: 1, d: 24 } as const;

/** Hours in a promise: "30m" is 0.5, "4h" is 4, "2d" is 48. Anything else is null. */
export function promiseHours(p: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(p.trim());
  return m ? Number(m[1]) * HOURS[m[2] as keyof typeof HOURS] : null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Who waits at the track's from-station, for how long, and whether any person waits past the promise. */
export function waitsOf(
  track: MetroTrack,
  people: readonly Person[],
  now: Date,
): { waiting: number; medianHours: number | null; late: boolean } {
  // The hub holds no one: a track that leaves it has nobody waiting.
  if (track.from === "hub") return { waiting: 0, medianHours: null, late: false };
  const here = people.filter((p) => p.node === track.from);
  const hours = here.flatMap((p) => {
    const t = p.movedAt ? Date.parse(p.movedAt) : Number.NaN;
    return Number.isNaN(t) ? [] : [Math.max(0, (now.getTime() - t) / 36e5)];
  });
  const limit = track.promise ? promiseHours(track.promise) : null;
  return {
    waiting: here.length,
    medianHours: median(hours),
    late: limit !== null && hours.some((h) => h > limit),
  };
}

/** "Ada North" is "AN"; one word gives one letter. */
const initialsOf = (owner: string): string =>
  owner
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** The tasks the shape gives: late first, then most waiting, then name. */
export function tasksOf(metro: MetroBody, people: readonly Person[], now: Date): Task[] {
  const station = new Map(metro.stations.map((s) => [s.id, s]));
  const lineName = new Map(metro.lines.map((l) => [l.id, l.label]));
  const tasks: Task[] = [];
  for (const t of metro.tracks) {
    if (t.by !== "person" || !t.owner) continue;
    const from = station.get(t.from);
    const to = station.get(t.to);
    // The line of the to-station. Out to the hub, where the to-station has none: the from-station's.
    const line = to?.line ?? from?.line ?? t.line ?? "";
    const limit = t.promise ? promiseHours(t.promise) : null;
    tasks.push({
      id: t.id,
      name: to?.label ?? t.to,
      owner: t.owner,
      initials: initialsOf(t.owner),
      line,
      lineName: lineName.get(line) ?? line,
      at: from?.label ?? t.from,
      ...waitsOf(t, people, now),
      promise: t.promise ?? null,
      promiseHours: limit,
    });
  }
  return tasks.sort(
    (a, b) =>
      Number(b.late) - Number(a.late) || b.waiting - a.waiting || a.name.localeCompare(b.name),
  );
}

/** Hours as a person says them: "40m", "6h", "3d". */
export function hoursSay(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

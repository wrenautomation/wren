/**
 * The content plan's weekly goals (`marketing.cadence`): what each piece still needs this week and
 * where it gets made. Studio's due cards and Today's Write card read it. The Plan page is gone
 * (WA-1207); per-campaign minimums come with WA-1204.
 */

import { PLATFORM_SPECS } from "@wren/starling-inbound/write";
import { useCall } from "../../load.js";
import { wrenRecords } from "../../records.js";

export interface Goal {
  id: string;
  platform: string;
  label: string;
  name: string;
  goal: number;
  upTo: number | null;
  pace: string;
  how: string;
  piece: string;
  pieceName: string;
  starts: "words" | "video" | "thread";
  daily: number | null;
  done: number | null;
  today: number | null;
  queued: number | null;
  write: number | null;
  /** The offer line it serves (a line id in the shape), when the plan says. */
  line?: string | null;
}

const RECORD = "marketing.cadence";
const OTHER: Record<string, string> = { newsletter: "Blog" };
export const placeName = (p: string) =>
  OTHER[p] ?? PLATFORM_SPECS[p as keyof typeof PLATFORM_SPECS]?.name ?? p;

/** Where the next one of a piece gets made: one place per piece, whatever platform. */
export const makeAt = (piece: string, gs: readonly Goal[]): { href: string; label: string } => {
  const g = gs[0];
  if (piece === "story")
    return {
      href: `/campaigns/studio?make=story&platform=${g?.platform ?? "instagram"}`,
      label: "Make a story",
    };
  if (piece === "newsletter") return { href: "/campaigns/studio?make=blog", label: "Write a post" };
  if (piece === "replies") return { href: "/campaigns/engage", label: "Answer threads" };
  if (g?.starts === "video")
    return {
      href: piece === "long" ? "/campaigns/studio?make=video" : "/campaigns/videos",
      label: piece === "long" ? "Record" : "Cut clips",
    };
  return { href: "/campaigns/studio", label: "Write" };
};

const counted = (gs: readonly Goal[]) => gs.filter((g) => g.done !== null);
/** One piece covers each of its goals: what it still lacks is its most lacking goal. */
const toMake = (gs: readonly Goal[]) => Math.max(0, ...counted(gs).map((g) => g.write ?? 0));

/** Goals by piece, in plan order. */
function byPiece(goals: readonly Goal[]): { piece: string; name: string; goals: Goal[] }[] {
  const out = new Map<string, { piece: string; name: string; goals: Goal[] }>();
  for (const g of goals) {
    const at = out.get(g.piece) ?? { piece: g.piece, name: g.pieceName, goals: [] };
    at.goals.push(g);
    out.set(g.piece, at);
  }
  return [...out.values()];
}

export const usePlan = () =>
  useCall("marketing-plan", () =>
    wrenRecords("marketing").list({ record: RECORD, view: "week", limit: 100 }),
  );
export const goalsOf = (rows: unknown[] | undefined) => (rows ?? []) as unknown as Goal[];

/** One piece the plan still asks for this week: what it needs, where it goes, and whether it is late. */
export interface Due {
  piece: string;
  name: string;
  /** The goals that still lack posts: the platforms it feeds. */
  goals: Goal[];
  /** How many it still needs. */
  n: number;
  /** The offer line it serves, when the plan says. */
  line: string | null;
  /** A daily goal is behind today. */
  late: boolean;
  make: { href: string; label: string };
}

/** The pieces still due this week, in plan order. */
export function dueOf(goals: Goal[]): Due[] {
  return byPiece(goals)
    .map((p) => {
      const open = counted(p.goals).filter((g) => (g.write ?? 0) > 0);
      return {
        piece: p.piece,
        name: p.name,
        goals: open,
        n: toMake(p.goals),
        line: open.find((g) => g.line)?.line ?? null,
        late: open.some((g) => g.daily !== null && (g.today ?? 0) < g.daily),
        make: makeAt(p.piece, counted(p.goals).length ? counted(p.goals) : p.goals),
      };
    })
    .filter((d) => d.n > 0);
}

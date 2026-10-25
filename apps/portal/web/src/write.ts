/**
 * Today's Write list: the content plan's goals (`modules/marketing/plan.tsx`) as one line per
 * platform, with today's quota and how much of it went out. The quota is the plan's own: a goal's
 * `daily`, else one for a weekly goal that still lacks or made one today. Pure, so it tests
 * without a page.
 */
import type { Goal } from "./modules/marketing/plan.js";

/** Named platforms, in the order they show. YouTube means its long-form goals only. */
const WRITE_ORDER = ["youtube", "linkedin", "reddit", "instagram", "facebook"] as const;
const NAMES: Record<string, string> = {
  youtube: "YouTube long-form",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  threads: "Threads",
  youtube_other: "YouTube shorts and posts",
  newsletter: "Blog",
};
/** Platforms that run on their own: one folded line. Any platform we do not name joins them. */
const AUTOPILOT = ["x", "tiktok", "threads"] as const;

export interface WriteLine {
  /** Platform key, or "autopilot". */
  id: string;
  label: string;
  /** Today's quota, and how much of it went out; a goal that made more than its own counts its own. */
  want: number;
  have: number;
  /** The goal that lacks most: where "make one" opens. */
  next: Goal;
  /** For Autopilot: the platforms folded in. */
  folded: string[];
}

export interface Write {
  /** Named platforms with a quota today, in order. */
  lines: WriteLine[];
  autopilot: WriteLine | null;
}

/** Today's quota for one goal. */
export const wantOf = (g: Goal) => g.daily ?? ((g.write ?? 0) > 0 || (g.today ?? 0) > 0 ? 1 : 0);
const haveOf = (g: Goal) => Math.min(g.today ?? 0, wantOf(g));
const lack = (g: Goal) => wantOf(g) - haveOf(g);

const lineOf = (
  id: string,
  label: string,
  goals: Goal[],
  folded: string[] = [],
): WriteLine | null => {
  const mine = goals.filter((g) => wantOf(g) > 0);
  const next = [...mine].sort((a, b) => lack(b) - lack(a))[0];
  if (!next) return null;
  return {
    id,
    label,
    want: mine.reduce((n, g) => n + wantOf(g), 0),
    have: mine.reduce((n, g) => n + haveOf(g), 0),
    next,
    folded,
  };
};

export const met = (l: WriteLine) => l.have >= l.want;

/** The plan's counted goals as Today's Write list. */
export function writeOf(goals: readonly Goal[]): Write {
  const counted = goals.filter((g) => g.done !== null);
  const named = new Set<string>(WRITE_ORDER);
  const key = (g: Goal) =>
    g.platform === "youtube" && g.piece !== "long" ? "youtube_other" : g.platform;
  const by = (k: string) => counted.filter((g) => key(g) === k);
  const lines = WRITE_ORDER.flatMap((p) => {
    const l = lineOf(p, NAMES[p] ?? p, by(p));
    return l ? [l] : [];
  });
  // Autopilot: X, TikTok, Threads, then whatever else the plan holds (YouTube's shorts and
  // posts, the blog, a platform added later).
  const rest = [
    ...new Set(counted.map(key).filter((k) => !named.has(k) && !AUTOPILOT.some((a) => a === k))),
  ];
  const keys = [...AUTOPILOT, ...rest];
  const goalsIn = keys.flatMap(by);
  const folded = keys.filter((k) => by(k).some((g) => wantOf(g) > 0)).map((k) => NAMES[k] ?? k);
  return { lines, autopilot: lineOf("autopilot", "Autopilot", goalsIn, folded) };
}

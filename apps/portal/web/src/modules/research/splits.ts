/**
 * Option E (designs/2026-11-16-weaver-moodboard.md): what sets the agent's picks apart from the
 * rest of the pages a run read, computed from fields the view already holds. Arithmetic only.
 */
import type { Speaker } from "@wren/ui/research/run";
import type { BoardPage } from "./board.js";
import type { PageTraits } from "./serve.js";

/** One yes/no trait; null: unknown for that page (not counted on either side). */
interface Trait {
  id: string;
  /** reads after "N of M picks …" */
  label: string;
  test: (p: BoardPage) => boolean | null;
}

export interface Split {
  id: string;
  label: string;
  /** picks with the trait, picks it is known for */
  picks: { yes: number; of: number };
  rest: { yes: number; of: number };
  /** pick share minus rest share, -1 to 1 */
  gap: number;
  /** the picks that have it, in rank order */
  on: BoardPage[];
}

const DAY = 86_400_000;
/** "N of M picks come from …"; `other` says nothing */
const FROM: Partial<Record<Speaker, string>> = {
  research: "research",
  person: "one person",
  forum: "a forum",
  press: "the press",
  company: "a company",
  public_body: "a public body",
};
const PLATFORM_NAME: Record<string, string> = {
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  reddit: "Reddit",
  linkedin: "LinkedIn",
};

/** at least this many known on each side, and this far apart, to show */
const MIN_KNOWN = 3;
const MIN_GAP = 0.2;

function traits(pages: readonly BoardPage[], at: number): Trait[] {
  const len = (p: BoardPage) => (p.d?.media === "video" ? (p.d.length ?? null) : null);
  const fixed: Trait[] = [
    { id: "video", label: "are videos", test: (p) => (p.d ? p.d.media === "video" : null) },
    { id: "short", label: "run under 60 s", test: (p) => below(len(p), 60) },
    { id: "long", label: "run over 3 min", test: (p) => below(180, len(p)) },
    {
      id: "recent",
      label: "came out in the 30 days before the run",
      test: (p) => {
        const t = p.d?.date ? Date.parse(p.d.date) : Number.NaN;
        return Number.isNaN(t) ? null : at - t <= 30 * DAY;
      },
    },
    {
      id: "hot",
      label: "got 10x or more their usual views",
      test: (p) => (p.r.multiple == null ? null : p.r.multiple >= 10),
    },
    {
      id: "small",
      label: "are from accounts under 10K followers",
      test: (p) => below(p.r.followers, 10_000),
    },
    {
      id: "reach",
      label: "got more views than the account has followers",
      test: (p) => {
        const f = p.s.score?.perFollower;
        return f == null ? null : f >= 1;
      },
    },
  ];
  // stored traits: over the run's median, or over 0 for a count most pages lack
  const measured = MEASURED.flatMap(({ key, over, label }) => {
    const known = pages.flatMap((p) => {
      const v = p.d?.traits?.[key];
      return v == null ? [] : [v];
    });
    if (!known.length) return [];
    const m = over === "median" ? median(known) : 0;
    const of = (p: BoardPage) => p.d?.traits?.[key];
    return [{ id: `t:${key}`, label: label(round1(m)), test: (p: BoardPage) => below(m, of(p)) }];
  });
  // one trait per platform and speaker the run met
  const platforms = new Set(pages.map((p) => p.r.platform));
  const speakers = new Set(pages.flatMap((p) => (p.d ? [p.d.speaker.value] : [])));
  return [
    ...fixed,
    ...measured,
    ...[...platforms].map((k) => ({
      id: `on:${k}`,
      label: `are on ${PLATFORM_NAME[k] ?? k}`,
      test: (p: BoardPage) => p.r.platform === k,
    })),
    ...[...speakers].flatMap((k) => {
      const from = FROM[k];
      if (!from) return [];
      return [
        {
          id: `by:${k}`,
          label: `come from ${from}`,
          test: (p: BoardPage) => (p.d ? p.d.speaker.value === k : null),
        },
      ];
    }),
  ];
}

const MEASURED: {
  key: keyof PageTraits;
  over: "median" | "zero";
  label: (m: number) => string;
}[] = [
  { key: "cutsPerMin", over: "median", label: (m) => `cut more than ${m} times a minute` },
  { key: "wordsPerS", over: "median", label: (m) => `speak more than ${m} words a second` },
  { key: "wordsPerCut", over: "median", label: (m) => `say more than ${m} words a cut` },
  { key: "changePicks", over: "median", label: (m) => `change the picture more than ${m} times` },
  { key: "pointsAtScreen", over: "zero", label: () => "point at the screen in words" },
  { key: "onScreenLines", over: "zero", label: () => "show text on screen" },
  { key: "words", over: "median", label: (m) => `run over ${m} words` },
  { key: "tables", over: "zero", label: () => "have a table" },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** a < b; null when either is unknown */
const below = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? null : a < b;

const share = (x: { yes: number; of: number }) => (x.of ? x.yes / x.of : 0);

/**
 * The traits where picks and the rest differ most, widest gap first. `at`: the run's start, so a
 * "recent" trait means the same on every visit.
 */
export function pickSplits(pages: readonly BoardPage[], at: number, max = 6): Split[] {
  const picks = pages.filter((p) => p.pick);
  const rest = pages.filter((p) => !p.pick);
  if (picks.length < MIN_KNOWN || rest.length < MIN_KNOWN) return [];
  const count = (set: BoardPage[], t: Trait) => {
    let yes = 0;
    let of = 0;
    for (const p of set) {
      const v = t.test(p);
      if (v == null) continue;
      of++;
      if (v) yes++;
    }
    return { yes, of };
  };
  const rank = (p: BoardPage) => p.pick?.rank ?? 999;
  return traits(pages, at)
    .map((t) => {
      const a = count(picks, t);
      const b = count(rest, t);
      return {
        id: t.id,
        label: t.label,
        picks: a,
        rest: b,
        gap: share(a) - share(b),
        on: picks.filter((p) => t.test(p) === true).sort((x, y) => rank(x) - rank(y)),
      };
    })
    .filter((s) => s.picks.of >= MIN_KNOWN && s.rest.of >= MIN_KNOWN && Math.abs(s.gap) >= MIN_GAP)
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))
    .slice(0, max);
}

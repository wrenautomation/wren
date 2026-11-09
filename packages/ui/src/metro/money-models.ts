/**
 * Money models as metro views: each play from the $100M Money Models video (knowledge guides/money-models), one
 * map each, in the SOP's stage order. Prices are the video's examples. Each choice point is one
 * A/B (`ab`) or one condition (`dec`), never a menu: the SOP's anchor rule. A line is what the buyer
 * gets: a choice of how to pay stays on its line, and only a change in what they get (a lesser offer,
 * a failed goal, an exit) starts a new one.
 */
import type { MetroView, ViewStation, ViewTrack } from "./view.js";

export interface MoneyPlay {
  view: MetroView;
  /** What the play does, in one line. */
  note: string;
}

export interface MoneyStage {
  title: string;
  /** What the stage is for. */
  goal: string;
  plays: MoneyPlay[];
}

const ad = { id: "ad", kind: "att", line: "ad", label: "Ad" } as const;
const hub = {
  id: "hub",
  kind: "hub",
  line: "ad",
  label: "First touch",
} as const;
const adLine = { id: "ad", tier: "out" } as const;
const intro = [
  { from: "ad", to: "hub", by: "system" },
  { from: "hub", to: "go", by: "system" },
] as const;

// ---------------------------------------------------------------------------------------------
// Stage one: attraction.

const WIN_BACK: MetroView = {
  title: "Win your money back",
  lines: [
    adLine,
    { id: "ch", offer: "6-week challenge", tier: "front", colour: 1 },
    { id: "core", offer: "Next offer", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "cash", line: "ch", label: "Challenge", sub: "$600" },
    { id: "goal", kind: "dec", line: "ch", label: "Lost 10 lb?" },
    {
      id: "keep",
      kind: "exit",
      line: "ch",
      label: "Missed goal",
      sub: "we keep $600",
    },
    { id: "pick", kind: "ab", line: "ch", label: "Cash or credit" },
    { id: "cash", kind: "exit", line: "ch", label: "Cash back", icon: "cashback" },
    {
      id: "next",
      kind: "cash",
      line: "core",
      label: "Credit to next offer",
      sub: "$600 kept",
      icon: "credit",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "goal", by: "system" },
    { from: "goal", to: "pick", by: "system", label: "yes" },
    { from: "goal", to: "keep", by: "system" },
    { from: "pick", to: "cash", by: "system", label: "cash" },
    { from: "pick", to: "next", by: "system", label: "credit" },
  ],
};

const GIVEAWAY: MetroView = {
  title: "Giveaway",
  lines: [
    adLine,
    { id: "gw", offer: "Full-ride scholarship", tier: "front", colour: 3 },
    { id: "core", offer: "Certification", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "att", line: "gw", label: "Apply to win", sub: "many" },
    { id: "pick", kind: "dec", line: "gw", label: "Picked?" },
    {
      id: "win",
      kind: "ok",
      line: "gw",
      label: "Winner",
      sub: "free, public",
      icon: "free",
    },
    {
      id: "part",
      kind: "cash",
      line: "core",
      label: "Partial scholarship",
      sub: "the rest",
      icon: "discount",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "pick", by: "system" },
    { from: "pick", to: "win", by: "system", label: "one" },
    { from: "pick", to: "part", by: "system", label: "private offer" },
  ],
};

const DECOY: MetroView = {
  title: "Decoy",
  lines: [
    adLine,
    { id: "pass", offer: "5-day pass", tier: "front", colour: 1 },
    { id: "vip", offer: "VIP month", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    {
      id: "go",
      kind: "cash",
      line: "pass",
      label: "5-day pass",
      sub: "$5",
      icon: "discount",
    },
    {
      id: "tan",
      kind: "dec",
      line: "pass",
      label: "How tan?",
      sub: "first visit",
    },
    {
      id: "teach",
      kind: "time",
      line: "pass",
      label: "5 to 10 sessions",
      sub: "breaks between",
    },
    {
      id: "pick",
      kind: "ab",
      line: "pass",
      label: "Pass or VIP",
      sub: "day pass $25",
      icon: "anchor",
    },
    { id: "use", kind: "time", line: "pass", label: "Uses 5 days" },
    { id: "end", kind: "exit", line: "pass", label: "Pass ends" },
    {
      id: "vipc",
      kind: "cash",
      line: "vip",
      label: "VIP unlimited",
      sub: "$19.99 a month",
      icon: "credit",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "tan", by: "system" },
    // Only a buyer who wants more than 5 days gives is shown the premium.
    { from: "tan", to: "teach", by: "person", owner: "Rep", promise: "at visit", label: "darker" },
    { from: "tan", to: "use", by: "system", label: "a little" },
    { from: "teach", to: "pick", by: "system" },
    { from: "pick", to: "use", by: "system", label: "pass" },
    { from: "pick", to: "vipc", by: "system", label: "$5 credited" },
    { from: "use", to: "pick", by: "system", label: "day 5", back: true },
    { from: "use", to: "end", by: "system" },
  ],
};

const BUY_GET: MetroView = {
  title: "Buy X get Y free",
  lines: [adLine, { id: "gym", offer: "Membership", tier: "core", colour: 0 }],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "gym", label: "Monthly or 6 + 12" },
    {
      id: "monthly",
      kind: "cash",
      line: "gym",
      label: "Month to month",
      sub: "$100 a month",
      icon: "anchor",
      repeat: "monthly",
    },
    {
      id: "prepaid",
      kind: "cash",
      line: "gym",
      label: "Buy 6, get 12 free",
      sub: "$1,800 now",
      icon: "free",
    },
    { id: "train", kind: "time", line: "gym", label: "Member trains" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "monthly", by: "system", label: "monthly" },
    { from: "go", to: "prepaid", by: "system", label: "cash now" },
    { from: "monthly", to: "train", by: "system" },
    { from: "prepaid", to: "train", by: "system" },
  ],
};

const PAY_LATER: MetroView = {
  title: "Pay less now or more later",
  lines: [adLine, { id: "ws", offer: "3-day workshop", tier: "front", colour: 1 }],
  stations: [
    ad,
    hub,
    { id: "go", kind: "time", line: "ws", label: "Workshop signup" },
    { id: "pick", kind: "ab", line: "ws", label: "Now or later" },
    {
      id: "card",
      kind: "cash",
      line: "ws",
      label: "$0 down",
      sub: "card on file",
    },
    {
      id: "paid",
      kind: "cash",
      line: "ws",
      label: "Paid today",
      sub: "$299 + recordings, call",
      was: "$500",
      icon: "discount",
    },
    { id: "held", kind: "time", line: "ws", label: "3-day workshop" },
    {
      id: "after",
      kind: "cash",
      line: "ws",
      label: "Card charged after",
      sub: "$500",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "pick", by: "system" },
    { from: "pick", to: "card", by: "system", label: "later" },
    { from: "pick", to: "paid", by: "system", label: "now" },
    { from: "card", to: "held", by: "system" },
    { from: "paid", to: "held", by: "system" },
    { from: "held", to: "after", by: "system", label: "if $0 down" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage two: upsells.

// The default upsell: unsell, prescribe and A/B in one visit. Each question is a small loop or a
// side branch that comes back to the line.
const COMBINED: MetroView = {
  title: "Combined upsell: unsell, prescribe, A/B",
  lines: [
    adLine,
    { id: "free", offer: "Free adjustment", tier: "front", colour: 1 },
    { id: "plan", offer: "Care plan", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    {
      id: "go",
      kind: "time",
      line: "free",
      label: "Free 30 min",
      sub: "hear the pain",
    },
    { id: "lic", kind: "dec", line: "free", label: "Licensed to prescribe?" },
    {
      id: "menu",
      kind: "plan",
      line: "free",
      label: "Show every option",
      icon: "anchor",
    },
    {
      id: "need",
      kind: "dec",
      line: "free",
      label: "Need this one?",
      sub: "pregnant? arthritis?",
    },
    {
      id: "cross",
      kind: "plan",
      line: "free",
      label: "Cross it off",
      icon: "close",
    },
    {
      id: "rx",
      kind: "ok",
      line: "plan",
      label: "Prescribe the plan",
      sub: "heat, trigger points, stretches",
    },
    { id: "when", kind: "ab", line: "plan", label: "Before or after work?" },
    { id: "card", kind: "ab", line: "plan", label: "Same card?" },
    { id: "new", kind: "plan", line: "plan", label: "New card", icon: "card" },
    {
      id: "paid",
      kind: "cash",
      line: "plan",
      label: "Care plan",
      sub: "only what they need",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "lic", by: "person", owner: "You", promise: "in visit" },
    // Authority earns the trust to prescribe at once. Without it, unselling earns it first.
    { from: "lic", to: "rx", by: "system", label: "yes" },
    { from: "lic", to: "menu", by: "system", label: "no" },
    { from: "menu", to: "need", by: "system" },
    { from: "need", to: "cross", by: "system", label: "no" },
    { from: "cross", to: "need", by: "system", label: "next item", back: true },
    { from: "need", to: "rx", by: "system", label: "what is left" },
    { from: "rx", to: "when", by: "system" },
    { from: "when", to: "card", by: "system", label: "either" },
    { from: "card", to: "paid", by: "system", label: "yes" },
    { from: "card", to: "new", by: "system", label: "no" },
    { from: "new", to: "paid", by: "system" },
  ],
};

const CLASSIC: MetroView = {
  title: "Classic upsell",
  lines: [
    adLine,
    { id: "bike", offer: "Bike", tier: "core", colour: 0 },
    { id: "add", offer: "Next problem", tier: "front", colour: 2 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "cash", line: "bike", label: "Bike", sub: "$299" },
    { id: "helmet", kind: "cash", line: "add", label: "Helmet", sub: "$45" },
    { id: "light", kind: "cash", line: "add", label: "Lights", sub: "$27" },
    {
      id: "tire",
      kind: "cash",
      line: "add",
      label: "Puncture-proof tires",
      sub: "$67",
    },
    {
      id: "cover",
      kind: "cash",
      line: "add",
      label: "2-year cover",
      sub: "$87 · $525 total",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "helmet", by: "person", owner: "Rep", promise: "at sale", label: "safe?" },
    { from: "helmet", to: "light", by: "system", label: "rides at night?" },
    { from: "light", to: "tire", by: "system", label: "flats?" },
    { from: "tire", to: "cover", by: "system", label: "if it breaks?" },
  ],
};

const ANCHOR: MetroView = {
  title: "Anchor upsell",
  lines: [
    adLine,
    { id: "prem", offer: "Premium", tier: "front", colour: 4 },
    { id: "real", offer: "Real offer", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "time", line: "real", label: "Fitting", sub: "budget $500" },
    {
      id: "show",
      kind: "att",
      line: "prem",
      label: "Show premium first",
      sub: "$16k tag",
      icon: "anchor",
    },
    { id: "pick", kind: "ab", line: "prem", label: "Care about designer?" },
    {
      id: "big",
      kind: "cash",
      line: "prem",
      label: "Premium suit",
      sub: "$16k · some buy",
    },
    { id: "suit", kind: "cash", line: "real", label: "Plain suit", sub: "$2,200" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "show", by: "person", owner: "Rep", promise: "first" },
    { from: "show", to: "pick", by: "system" },
    { from: "pick", to: "big", by: "system", label: "yes" },
    { from: "pick", to: "suit", by: "system", label: "no: relief" },
  ],
};

const ROLLOVER: MetroView = {
  title: "Rollover",
  lines: [
    adLine,
    { id: "ch", offer: "Challenge", tier: "front", colour: 1 },
    { id: "mem", offer: "Year membership", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "cash", line: "ch", label: "Challenge", sub: "$600" },
    { id: "won", kind: "ok", line: "ch", label: "Won it back" },
    {
      id: "old",
      kind: "att",
      line: "ch",
      label: "Old or upset client",
      sub: "$500 credit call",
    },
    { id: "pick", kind: "ab", line: "ch", label: "Cash or credit" },
    {
      id: "cash",
      kind: "exit",
      line: "ch",
      label: "Cash back",
      sub: "never hostage",
      icon: "cashback",
    },
    {
      id: "mem",
      kind: "cash",
      line: "mem",
      label: "Membership",
      sub: "$150 a month",
      was: "$200",
      icon: "credit",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "won", by: "system" },
    { from: "won", to: "pick", by: "system" },
    { from: "old", to: "pick", by: "person", owner: "You", promise: "1 call" },
    { from: "pick", to: "cash", by: "system", label: "cash" },
    { from: "pick", to: "mem", by: "system", label: "roll it over" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage two: downsells. Change how they pay first, what they get second.

const PAYMENT_PLAN: MetroView = {
  title: "Payment plan downsell",
  lines: [adLine, { id: "buy", offer: "Program", tier: "core", colour: 0 }],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "buy", label: "Pay in full + bonuses?" },
    { id: "fin", kind: "ab", line: "buy", label: "Card or financing?" },
    { id: "half", kind: "ab", line: "buy", label: "Half now, half later?" },
    { id: "want", kind: "dec", line: "buy", label: "Still want it?" },
    {
      id: "pif",
      kind: "cash",
      line: "buy",
      label: "Paid in full",
      sub: "all bonuses",
      icon: "free",
    },
    { id: "split", kind: "cash", line: "buy", label: "3 payments" },
    { id: "value", kind: "exit", line: "buy", label: "Value problem", bad: true },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "pif", by: "system", label: "yes" },
    { from: "go", to: "fin", by: "system", label: "no", no: true },
    { from: "fin", to: "pif", by: "system", label: "financed" },
    { from: "fin", to: "half", by: "system", label: "no", no: true },
    { from: "half", to: "pif", by: "system", label: "50/50" },
    { from: "half", to: "want", by: "system", label: "no", no: true },
    { from: "want", to: "split", by: "system", label: "money problem" },
    { from: "want", to: "value", by: "system" },
  ],
};

const TRIAL_PENALTY: MetroView = {
  title: "Trial with penalty",
  lines: [
    adLine,
    { id: "trial", offer: "14-day trial", tier: "front", colour: 1 },
    { id: "core", offer: "Program", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    {
      id: "go",
      kind: "time",
      line: "trial",
      label: "Call",
      sub: "money is tight",
    },
    {
      id: "start",
      kind: "ok",
      line: "trial",
      label: "Free start",
      sub: "card on file",
      icon: "free",
    },
    { id: "duty", kind: "dec", line: "trial", label: "Did every duty?" },
    {
      id: "fee",
      kind: "cash",
      line: "trial",
      label: "Small fee",
      sub: "back on track",
    },
    {
      id: "bill",
      kind: "cash",
      line: "core",
      label: "Billed at day 14",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    {
      from: "go",
      to: "start",
      by: "person",
      owner: "Rep",
      promise: "on call",
      label: "no",
      no: true,
    },
    { from: "start", to: "duty", by: "system" },
    { from: "duty", to: "fee", by: "system", label: "missed one" },
    { from: "fee", to: "duty", by: "system", back: true },
    { from: "duty", to: "bill", by: "system", label: "day 14" },
  ],
};

const FEATURE: MetroView = {
  title: "Feature downsell",
  lines: [
    adLine,
    { id: "full", offer: "Full offer", tier: "core", colour: 0 },
    { id: "less", offer: "Less of it", tier: "front", colour: 2 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "full", label: "Full offer?" },
    {
      id: "two",
      kind: "ab",
      line: "less",
      label: "2 sessions, not 4?",
      sub: "worse deal",
    },
    {
      id: "diy",
      kind: "cash",
      line: "less",
      label: "Do it yourself",
      sub: "paint + sprayer rent",
    },
    {
      id: "best",
      kind: "cash",
      line: "full",
      label: "Full offer",
      sub: "best deal",
    },
    { id: "lite", kind: "cash", line: "less", label: "2 sessions a month" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "best", by: "system", label: "yes" },
    { from: "go", to: "two", by: "system", label: "no", no: true },
    { from: "two", to: "lite", by: "system", label: "yes" },
    { from: "two", to: "diy", by: "system", label: "no", no: true },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage three: continuity.

/** What a retainer play changes: its sale, its onboarding, and its terms on the lap. */
interface RetainerTerms {
  title: string;
  /** The offer the core line sells. */
  offer: string;
  /** From the hub to the kickoff: the sale and its terms. Its tracks start at `go` and end at `ko`. */
  sale: { stations: ViewStation[]; tracks: ViewTrack[] };
  /** More onboarding after the kickoff, in order. */
  onboarding?: ViewStation[];
  /** The bill on the lap. */
  bill?: Partial<ViewStation>;
  /** A missed payment: the exit from the bill. */
  missed?: Partial<ViewStation>;
  /** A client who leaves: the exit from the review. Rewarm starts from it. */
  churn?: Partial<ViewStation>;
}

/**
 * A retainer: the sale, the onboarding, then a lap that repeats every 30 days (plan, make, ship,
 * bill, report, review). A missed payment leaves from the bill; a client who leaves rests, gets a
 * check-in and a win-back offer, and comes back to the kickoff. Each continuity play is this lap
 * with its own terms: "make leaving a loss" lives on the bill and the exits.
 */
function retainer(t: RetainerTerms): MetroView {
  const on = (id: string, label: string, more: Partial<ViewStation> = {}): ViewStation => ({
    id,
    kind: "time",
    line: "core",
    label,
    group: "loop",
    ...more,
  });
  const onboarding: ViewStation[] = [
    {
      id: "ko",
      kind: "time",
      line: "core",
      label: "Kickoff",
      sub: "day 0",
      group: "on",
    },
    ...(t.onboarding ?? []).map((s) => ({ ...s, group: "on" })),
  ];
  const work: ViewStation[] = [
    // The top row, left to right, then the bottom row back: the stations with exits sit on it.
    on("pl", "Plan", { sub: "day 1" }),
    on("mk", "Make", { sub: "days 2 to 20" }),
    on("sh", "Ship", { kind: "att", sub: "days 21 to 28" }),
    on("bl", "Monthly bill", { kind: "cash", ...t.bill }),
    on("rp", "Report", { kind: "att", sub: "day 28" }),
    on("rv", "Review call", { sub: "day 30" }),
  ];
  const chain = (ids: string[]): ViewTrack[] =>
    ids.slice(1).map((to, i) => ({ from: ids[i] as string, to, by: "system" }));
  return {
    title: t.title,
    lines: [
      adLine,
      { id: "core", offer: t.offer, tier: "core", colour: 0 },
      { id: "rw", label: "Rewarm", tier: "out" },
    ],
    groups: [
      { id: "offer", label: t.offer },
      { id: "on", label: "Onboarding", parent: "offer" },
      { id: "loop", label: "Monthly lap", parent: "offer", lap: "every 30 days" },
      { id: "rw", label: "Rewarm", parent: "offer" },
    ],
    stations: [
      ad,
      hub,
      // The sale sits in the offer, so the whole offer folds to one circle.
      ...t.sale.stations.map((s) => ({ group: "offer", ...s })),
      ...onboarding,
      ...work,
      {
        id: "fp",
        kind: "exit",
        line: "core",
        label: "Failed payment",
        bad: true,
        ...t.missed,
      },
      {
        id: "ch",
        kind: "exit",
        line: "core",
        label: "Leaves",
        bad: true,
        ...t.churn,
      },
      {
        id: "rs",
        kind: "time",
        line: "rw",
        label: "Rest 90 days",
        group: "rw",
      },
      {
        id: "ci",
        kind: "att",
        line: "rw",
        label: "Check-in",
        sub: "day 180",
        group: "rw",
      },
      {
        id: "wb",
        kind: "cash",
        line: "rw",
        label: "Win-back offer",
        sub: "month 1 at half price",
        group: "rw",
      },
    ],
    tracks: [
      ...intro,
      ...t.sale.tracks,
      ...chain(onboarding.map((s) => s.id)),
      { from: onboarding.at(-1)?.id ?? "ko", to: "pl", by: "system" },
      ...chain(work.map((s) => s.id)),
      { from: "rv", to: "pl", by: "person", owner: "You", promise: "30d", label: "next month" },
      { from: "bl", to: "fp", by: "system" },
      { from: "rv", to: "ch", by: "system" },
      { from: "ch", to: "rs", by: "system", label: "rewarm" },
      ...chain(["rs", "ci", "wb"]),
      { from: "wb", to: "ko", by: "system", label: "yes" },
    ],
  };
}

/** The default: a monthly retainer with a real onboarding. */
export const GROWTH_RETAINER: MetroView = retainer({
  title: "Growth Retainer",
  offer: "Growth Retainer",
  sale: {
    stations: [
      { id: "go", kind: "att", line: "core", label: "Proposal" },
      {
        id: "sg",
        kind: "cash",
        line: "core",
        label: "Signed",
        sub: "$4k a month",
      },
    ],
    tracks: [
      { from: "go", to: "sg", by: "system" },
      { from: "sg", to: "ko", by: "system" },
    ],
  },
  onboarding: [
    {
      id: "ac",
      kind: "att",
      line: "core",
      label: "Logins",
      sub: "days 1 to 3",
    },
    {
      id: "bw",
      kind: "time",
      line: "core",
      label: "Build week",
      sub: "days 4 to 10",
    },
  ],
  bill: { sub: "$4k" },
});

const BONUS_CONT = retainer({
  title: "Continuity with bonuses",
  offer: "Membership",
  sale: {
    stations: [
      {
        id: "go",
        kind: "ok",
        line: "core",
        label: "Bonuses",
        sub: "worth more than month 1",
        icon: "free",
      },
      { id: "pre", kind: "ab", line: "core", label: "Prepay 6, save 20%?" },
      {
        id: "six",
        kind: "cash",
        line: "core",
        label: "Prepaid 6 months",
        sub: "$960 now",
        was: "$1,200",
        icon: "discount",
      },
    ],
    tracks: [
      { from: "go", to: "pre", by: "system" },
      { from: "pre", to: "six", by: "system", label: "yes" },
      { from: "pre", to: "ko", by: "system", label: "no" },
      { from: "six", to: "ko", by: "system" },
    ],
  },
  bill: { sub: "$200" },
});

const DISCOUNT_CONT = retainer({
  title: "Discount continuity",
  offer: "Membership",
  sale: {
    stations: [
      {
        id: "go",
        kind: "cash",
        line: "core",
        label: "Rate kept while on time",
        sub: "$150 a month",
        was: "$200",
        icon: "discount",
      },
    ],
    tracks: [{ from: "go", to: "ko", by: "system" }],
  },
  bill: { sub: "$150", was: "$200", icon: "discount" },
  missed: { label: "Missed payment", sub: "discount lost, back to $200" },
});

const WAIVED_FEE = retainer({
  title: "Waived fee",
  offer: "Membership",
  sale: {
    stations: [
      { id: "go", kind: "ab", line: "core", label: "Setup fee, or a year?" },
      {
        id: "fee",
        kind: "cash",
        line: "core",
        label: "Setup fee",
        sub: "month to month",
        icon: "anchor",
      },
      {
        id: "yr",
        kind: "ok",
        line: "core",
        label: "Year: fee waived",
        icon: "free",
      },
    ],
    tracks: [
      { from: "go", to: "fee", by: "system", label: "month to month" },
      { from: "go", to: "yr", by: "system", label: "a year" },
      { from: "fee", to: "ko", by: "system" },
      { from: "yr", to: "ko", by: "system" },
    ],
  },
  bill: { sub: "$200" },
  churn: { label: "Quits in year 1", sub: "fee owed" },
});

// ---------------------------------------------------------------------------------------------
// The whole model: the video's gym, attraction → rollover → continuity, with the no path.

export const GYM_MODEL: MetroView = {
  title: "Whole model: the gym",
  lines: [
    adLine,
    { id: "ch", offer: "Win-back challenge", tier: "front", colour: 1 },
    { id: "mem", offer: "Membership", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    {
      id: "go",
      kind: "cash",
      line: "ch",
      label: "Challenge",
      sub: "$600 · attraction",
    },
    { id: "goal", kind: "dec", line: "ch", label: "Hit the goal?" },
    { id: "pick", kind: "ab", line: "ch", label: "Cash or credit" },
    {
      id: "cash",
      kind: "exit",
      line: "ch",
      label: "Cash back",
      icon: "cashback",
    },
    {
      id: "pre",
      kind: "ab",
      line: "mem",
      label: "Prepay 6, save 20%?",
      sub: "upsell",
    },
    {
      id: "six",
      kind: "cash",
      line: "mem",
      label: "Prepaid",
      sub: "$960 now · continuity",
      was: "$1,200",
      icon: "discount",
    },
    {
      id: "mo",
      kind: "cash",
      line: "mem",
      label: "Member",
      sub: "$150 a month · rollover",
      was: "$200",
      icon: "credit",
      repeat: "monthly",
    },
    {
      id: "pp",
      kind: "cash",
      line: "mem",
      label: "Member on a plan",
      sub: "downsell",
      repeat: "monthly",
    },
  ],
  tracks: [
    { from: "ad", to: "go", by: "system" },
    { from: "go", to: "goal", by: "system" },
    { from: "goal", to: "pick", by: "system", label: "yes" },
    {
      from: "goal",
      to: "pp",
      by: "person",
      owner: "Rep",
      promise: "week 6",
      label: "no",
      no: true,
    },
    { from: "pick", to: "cash", by: "system", label: "cash" },
    { from: "pick", to: "pre", by: "system", label: "credit" },
    { from: "pre", to: "six", by: "system", label: "yes" },
    { from: "pre", to: "mo", by: "system", label: "no" },
  ],
};

/** The video's plays in the SOP's order: attraction, upsells, downsells, continuity. */
export const MONEY_STAGES: MoneyStage[] = [
  {
    title: "Attraction",
    goal: "Turn strangers into buyers. The cash covers the cost to get and serve them.",
    plays: [
      {
        view: WIN_BACK,
        note: "They pay, hit a goal, and win it back as cash or as credit to the next offer.",
      },
      {
        view: GIVEAWAY,
        note: "Many apply to win. One wins. The rest get a private discount on the core.",
      },
      {
        view: DECOY,
        note: "A cheap pass brings them in. Want more than it gives? The premium sits beside it, the $5 credited.",
      },
      {
        view: BUY_GET,
        note: "Same total as month to month, framed as free months. Cash up front.",
      },
      { view: PAY_LATER, note: "$0 now and full price later, or less today with bonuses." },
    ],
  },
  {
    title: "Upsells",
    goal: "Sell the fix for the next problem, at the moment they see it.",
    plays: [
      {
        view: COMBINED,
        note: "The default. Cross off what they don't need, prescribe the rest, then ask which, not whether.",
      },
      {
        view: CLASSIC,
        note: "The basic upsell. Each add-on solves the problem the last one showed.",
      },
      { view: ANCHOR, note: "Premium first. The real offer then reads as a relief." },
      {
        view: ROLLOVER,
        note: "Credit what they spent or won toward a bigger commitment at a better rate.",
      },
    ],
  },
  {
    title: "Downsells",
    goal: "Make money on a no. Change how they pay first, what they get second.",
    plays: [
      {
        view: PAYMENT_PLAN,
        note: "Full plus bonuses, then financing, then half and half, then a split.",
      },
      {
        view: TRIAL_PENALTY,
        note: "Free start with card on file. A missed duty costs a small fee.",
      },
      {
        view: FEATURE,
        note: "Take value out first. The full offer stays the best deal, so many buy it back.",
      },
    ],
  },
  {
    title: "Continuity",
    goal: "Keep them paying. Make leaving a loss.",
    plays: [
      {
        view: GROWTH_RETAINER,
        note: "The default. A lap every 30 days; a client who leaves rests, then gets a win-back offer.",
      },
      {
        view: BONUS_CONT,
        note: "Bonuses worth more than the first payment, then a prepay discount.",
      },
      {
        view: DISCOUNT_CONT,
        note: "A lower rate kept while they pay on time. A missed payment loses it.",
      },
      {
        view: WAIVED_FEE,
        note: "A big fee for month to month, waived for a year. Quit early, pay it.",
      },
    ],
  },
];

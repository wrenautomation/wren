/**
 * Money models as metro views: each play from the $100M Money Models video (sops/money-models), one
 * map each, in the SOP's stage order. Prices are the video's examples. Each choice point is one
 * A/B (`ab`) or one condition (`dec`), never a menu: the SOP's anchor rule.
 */
import type { MetroView } from "./view.js";

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

const ad = { id: "ad", kind: "att", line: "ad", column: "Marketing", label: "Ad" } as const;
const hub = {
  id: "hub",
  kind: "hub",
  line: "ad",
  column: "Marketing",
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
    { id: "go", kind: "cash", line: "ch", column: "Sales", label: "Challenge", sub: "$600" },
    { id: "goal", kind: "dec", line: "ch", column: "Delivery", label: "Lost 10 lb?" },
    {
      id: "keep",
      kind: "exit",
      line: "ch",
      column: "Delivery",
      label: "Missed goal",
      sub: "we keep $600",
    },
    { id: "pick", kind: "ab", line: "ch", column: "Money", label: "Cash or credit" },
    { id: "cash", kind: "exit", line: "ch", column: "Money", label: "Cash back" },
    {
      id: "next",
      kind: "cash",
      line: "core",
      column: "Money",
      label: "Credit to next offer",
      sub: "$600 kept",
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
    { id: "go", kind: "att", line: "gw", column: "Sales", label: "Apply to win", sub: "many" },
    { id: "pick", kind: "dec", line: "gw", column: "Sales", label: "Picked?" },
    { id: "win", kind: "ok", line: "gw", column: "Delivery", label: "Winner", sub: "free, public" },
    {
      id: "part",
      kind: "cash",
      line: "core",
      column: "Money",
      label: "Partial scholarship",
      sub: "the rest",
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
    { id: "go", kind: "cash", line: "pass", column: "Sales", label: "5-day pass", sub: "$5" },
    {
      id: "visit",
      kind: "time",
      line: "pass",
      column: "Delivery",
      label: "First visit",
      sub: "how tan?",
    },
    { id: "pick", kind: "ab", line: "pass", column: "Delivery", label: "Pass or VIP" },
    { id: "stay", kind: "exit", line: "pass", column: "Money", label: "Keeps 5 days" },
    {
      id: "vipc",
      kind: "cash",
      line: "vip",
      column: "Money",
      label: "VIP unlimited",
      sub: "$19.99 / mo",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "visit", by: "system" },
    { from: "visit", to: "pick", by: "person", owner: "Rep", promise: "at visit" },
    { from: "pick", to: "stay", by: "system", label: "pass" },
    { from: "pick", to: "vipc", by: "system", label: "$5 credited" },
  ],
};

const BUY_GET: MetroView = {
  title: "Buy X get Y free",
  columns: ["Marketing", "Sales", "Money"],
  lines: [
    adLine,
    { id: "mo", offer: "Month to month", tier: "front", colour: 1 },
    { id: "pre", offer: "6 + 12 free", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "mo", column: "Sales", label: "Monthly or 6 + 12" },
    {
      id: "monthly",
      kind: "cash",
      line: "mo",
      column: "Money",
      label: "Month to month",
      sub: "$100 / mo",
      repeat: "monthly",
    },
    {
      id: "prepaid",
      kind: "cash",
      line: "pre",
      column: "Money",
      label: "Buy 6, get 12 free",
      sub: "$1,800 now",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "monthly", by: "system", label: "anchor" },
    { from: "go", to: "prepaid", by: "system", label: "same total, cash now" },
  ],
};

const PAY_LATER: MetroView = {
  title: "Pay less now or more later",
  lines: [
    adLine,
    { id: "later", offer: "$0 down", tier: "front", colour: 1 },
    { id: "now", offer: "Pay now + bonuses", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "time", line: "later", column: "Sales", label: "Workshop signup" },
    { id: "pick", kind: "ab", line: "later", column: "Sales", label: "Now or later" },
    { id: "held", kind: "time", line: "later", column: "Delivery", label: "3-day workshop" },
    {
      id: "after",
      kind: "cash",
      line: "later",
      column: "Money",
      label: "Card charged after",
      sub: "$500",
    },
    {
      id: "paid",
      kind: "cash",
      line: "now",
      column: "Money",
      label: "Paid today",
      sub: "$299 + recordings, call",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "pick", by: "system" },
    { from: "pick", to: "held", by: "system", label: "$0 down" },
    { from: "held", to: "after", by: "system" },
    { from: "pick", to: "paid", by: "system", label: "pay now" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage two: upsells.

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
    { id: "go", kind: "cash", line: "bike", column: "Sales", label: "Bike", sub: "$299" },
    { id: "helmet", kind: "cash", line: "add", column: "Delivery", label: "Helmet", sub: "$45" },
    { id: "light", kind: "cash", line: "add", column: "Delivery", label: "Lights", sub: "$27" },
    {
      id: "tire",
      kind: "cash",
      line: "add",
      column: "Money",
      label: "Puncture-proof tires",
      sub: "$67",
    },
    {
      id: "cover",
      kind: "cash",
      line: "add",
      column: "Money",
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

const MENU: MetroView = {
  title: "Menu upsell: unsell, prescribe, A/B",
  lines: [
    adLine,
    { id: "free", offer: "Free adjustment", tier: "front", colour: 1 },
    { id: "plan", offer: "Care plan", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "time", line: "free", column: "Sales", label: "Free 30 min" },
    {
      id: "unsell",
      kind: "dec",
      line: "free",
      column: "Sales",
      label: "Unsell",
      sub: "cross off what they don't need",
    },
    { id: "rx", kind: "ok", line: "plan", column: "Delivery", label: "Prescribe the plan" },
    { id: "when", kind: "ab", line: "plan", column: "Delivery", label: "Before or after work?" },
    { id: "card", kind: "ab", line: "plan", column: "Money", label: "Card on file?" },
    { id: "paid", kind: "cash", line: "plan", column: "Money", label: "Care plan" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "unsell", by: "person", owner: "Doc", promise: "in visit" },
    { from: "unsell", to: "rx", by: "system", label: "what is left" },
    { from: "rx", to: "when", by: "system" },
    { from: "when", to: "card", by: "system" },
    { from: "card", to: "paid", by: "system" },
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
    { id: "go", kind: "time", line: "real", column: "Sales", label: "Fitting", sub: "budget $500" },
    {
      id: "show",
      kind: "att",
      line: "prem",
      column: "Sales",
      label: "Show premium first",
      sub: "$16k tag",
    },
    { id: "pick", kind: "ab", line: "prem", column: "Delivery", label: "Care about designer?" },
    {
      id: "big",
      kind: "cash",
      line: "prem",
      column: "Money",
      label: "Premium suit",
      sub: "$16k · some buy",
    },
    { id: "suit", kind: "cash", line: "real", column: "Money", label: "Plain suit", sub: "$2,200" },
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
    { id: "go", kind: "cash", line: "ch", column: "Sales", label: "Challenge", sub: "$600" },
    { id: "won", kind: "ok", line: "ch", column: "Delivery", label: "Won it back" },
    {
      id: "old",
      kind: "att",
      line: "ch",
      column: "Delivery",
      label: "Old or upset client",
      sub: "$500 credit call",
    },
    { id: "pick", kind: "ab", line: "ch", column: "Money", label: "Cash or credit" },
    {
      id: "cash",
      kind: "exit",
      line: "ch",
      column: "Money",
      label: "Cash back",
      sub: "never hostage",
    },
    {
      id: "mem",
      kind: "cash",
      line: "mem",
      column: "Money",
      label: "Membership",
      sub: "$150 not $200 / mo",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "won", by: "system" },
    { from: "won", to: "pick", by: "system" },
    { from: "old", to: "pick", by: "person", owner: "Own", promise: "1 call" },
    { from: "pick", to: "cash", by: "system", label: "cash" },
    { from: "pick", to: "mem", by: "system", label: "roll it over" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage two: downsells. Change how they pay first, what they get second.

const PAYMENT_PLAN: MetroView = {
  title: "Payment plan downsell",
  lines: [
    adLine,
    { id: "full", offer: "Paid in full", tier: "core", colour: 0 },
    { id: "plan", offer: "Payment plan", tier: "front", colour: 1 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "full", column: "Sales", label: "Pay in full + bonuses?" },
    { id: "fin", kind: "ab", line: "plan", column: "Sales", label: "Card or financing?" },
    { id: "half", kind: "ab", line: "plan", column: "Delivery", label: "Half now, half later?" },
    { id: "want", kind: "dec", line: "plan", column: "Delivery", label: "Still want it?" },
    {
      id: "pif",
      kind: "cash",
      line: "full",
      column: "Money",
      label: "Paid in full",
      sub: "all bonuses",
    },
    { id: "split", kind: "cash", line: "plan", column: "Money", label: "3 payments" },
    { id: "value", kind: "exit", line: "plan", column: "Money", label: "Value problem", bad: true },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "pif", by: "system", label: "yes" },
    { from: "go", to: "fin", by: "system", label: "no" },
    { from: "fin", to: "pif", by: "system", label: "financed" },
    { from: "fin", to: "half", by: "system", label: "no" },
    { from: "half", to: "pif", by: "system", label: "50/50" },
    { from: "half", to: "want", by: "system", label: "no" },
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
      column: "Sales",
      label: "Call",
      sub: "money is tight",
    },
    {
      id: "start",
      kind: "ok",
      line: "trial",
      column: "Delivery",
      label: "Free start",
      sub: "card on file",
    },
    { id: "duty", kind: "dec", line: "trial", column: "Delivery", label: "Did every duty?" },
    {
      id: "fee",
      kind: "cash",
      line: "trial",
      column: "Delivery",
      label: "Small fee",
      sub: "back on track",
    },
    {
      id: "bill",
      kind: "cash",
      line: "core",
      column: "Money",
      label: "Billed at day 14",
      repeat: "monthly",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "start", by: "person", owner: "Rep", promise: "on call" },
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
    { id: "go", kind: "ab", line: "full", column: "Sales", label: "Full offer?" },
    {
      id: "two",
      kind: "ab",
      line: "less",
      column: "Delivery",
      label: "2 sessions, not 4?",
      sub: "worse deal",
    },
    {
      id: "diy",
      kind: "cash",
      line: "less",
      column: "Money",
      label: "Do it yourself",
      sub: "paint + sprayer rent",
    },
    {
      id: "best",
      kind: "cash",
      line: "full",
      column: "Money",
      label: "Full offer",
      sub: "best deal",
    },
    { id: "lite", kind: "cash", line: "less", column: "Money", label: "2 sessions / mo" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "best", by: "system", label: "yes" },
    { from: "go", to: "two", by: "system", label: "no" },
    { from: "two", to: "lite", by: "system", label: "yes" },
    { from: "two", to: "diy", by: "system", label: "no" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Stage three: continuity.

const BONUS_CONT: MetroView = {
  title: "Continuity with bonuses",
  lines: [
    adLine,
    { id: "ch", offer: "Challenge", tier: "front", colour: 1 },
    { id: "mem", offer: "Membership", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "ch", column: "Sales", label: "Challenge, or free as a member?" },
    { id: "one", kind: "cash", line: "ch", column: "Money", label: "Challenge only", sub: "$600" },
    {
      id: "pre",
      kind: "ab",
      line: "mem",
      column: "Delivery",
      label: "Prepay 6, save 20%?",
      sub: "bonuses > first month",
    },
    {
      id: "mo",
      kind: "cash",
      line: "mem",
      column: "Money",
      label: "Member",
      sub: "$200 / mo",
      repeat: "monthly",
    },
    {
      id: "six",
      kind: "cash",
      line: "mem",
      column: "Money",
      label: "Prepaid 6 months",
      sub: "$960 now",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "one", by: "system", label: "challenge" },
    { from: "go", to: "pre", by: "system", label: "member" },
    { from: "pre", to: "mo", by: "system", label: "no" },
    { from: "pre", to: "six", by: "system", label: "yes" },
  ],
};

const DISCOUNT_CONT: MetroView = {
  title: "Discount continuity",
  lines: [
    adLine,
    { id: "end", offer: "Free months at the end", tier: "front", colour: 1 },
    { id: "life", offer: "Spread for life", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "end", column: "Sales", label: "Which discount?" },
    {
      id: "year",
      kind: "cash",
      line: "end",
      column: "Delivery",
      label: "12 months",
      sub: "$200 / mo",
      repeat: "monthly",
    },
    {
      id: "quit",
      kind: "exit",
      line: "end",
      column: "Delivery",
      label: "Cancels early",
      sub: "loses 3 free",
      bad: true,
    },
    { id: "free", kind: "ok", line: "end", column: "Money", label: "3 months free" },
    {
      id: "rate",
      kind: "cash",
      line: "life",
      column: "Money",
      label: "Rate kept for life",
      sub: "$150 / mo",
      repeat: "on time",
    },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "year", by: "system", label: "at the end" },
    { from: "year", to: "free", by: "system", label: "no missed payment" },
    { from: "year", to: "quit", by: "system" },
    { from: "go", to: "rate", by: "system", label: "spread" },
  ],
};

const WAIVED_FEE: MetroView = {
  title: "Waived fee",
  lines: [
    adLine,
    { id: "mtm", offer: "Fee + month to month", tier: "front", colour: 1 },
    { id: "yr", offer: "Year, fee waived", tier: "core", colour: 0 },
  ],
  stations: [
    ad,
    hub,
    { id: "go", kind: "ab", line: "mtm", column: "Sales", label: "Fee or a year?" },
    {
      id: "fee",
      kind: "cash",
      line: "mtm",
      column: "Money",
      label: "Setup fee + monthly",
      sub: "cancel any time",
    },
    {
      id: "year",
      kind: "cash",
      line: "yr",
      column: "Delivery",
      label: "Year, no fee",
      repeat: "monthly",
    },
    { id: "quit", kind: "dec", line: "yr", column: "Delivery", label: "Quits early?" },
    { id: "owed", kind: "cash", line: "yr", column: "Money", label: "Pays the waived fee" },
    { id: "stay", kind: "ok", line: "yr", column: "Money", label: "Committed client" },
  ],
  tracks: [
    ...intro,
    { from: "go", to: "fee", by: "system", label: "anchor" },
    { from: "go", to: "year", by: "system", label: "commit" },
    { from: "year", to: "quit", by: "system" },
    { from: "quit", to: "owed", by: "system", label: "yes" },
    { from: "quit", to: "stay", by: "system", label: "no" },
  ],
};

// ---------------------------------------------------------------------------------------------
// The whole model: the video's gym, attraction → rollover → continuity, with the no path.

export const GYM_MODEL: MetroView = {
  title: "Whole model: the gym",
  lines: [
    adLine,
    { id: "ch", offer: "Win-back challenge", tier: "front", colour: 1 },
    { id: "mem", offer: "Membership", tier: "core", colour: 0 },
    { id: "plan", offer: "Payment plan", tier: "front", colour: 2 },
  ],
  stations: [
    ad,
    {
      id: "go",
      kind: "cash",
      line: "ch",
      column: "Sales",
      label: "Challenge",
      sub: "$600 · attraction",
    },
    { id: "goal", kind: "dec", line: "ch", column: "Delivery", label: "Hit the goal?" },
    { id: "pick", kind: "ab", line: "ch", column: "Delivery", label: "Cash or credit" },
    { id: "cash", kind: "exit", line: "ch", column: "Delivery", label: "Cash back" },
    {
      id: "pre",
      kind: "ab",
      line: "mem",
      column: "Delivery",
      label: "Prepay 6, save 20%?",
      sub: "upsell",
    },
    {
      id: "six",
      kind: "cash",
      line: "mem",
      column: "Money",
      label: "Prepaid",
      sub: "$960 now · continuity",
    },
    {
      id: "mo",
      kind: "cash",
      line: "mem",
      column: "Money",
      label: "Member",
      sub: "$150 / mo · rollover",
      repeat: "monthly",
    },
    {
      id: "pp",
      kind: "cash",
      line: "plan",
      column: "Money",
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
        note: "A cheap offer brings them in. A clearly better premium sits beside it.",
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
      { view: CLASSIC, note: "Each add-on solves the problem the last purchase made visible." },
      {
        view: MENU,
        note: "Cross off what they don't need, prescribe the rest, then ask which, not whether.",
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
        view: BONUS_CONT,
        note: "Bonuses worth more than the first payment, then a prepay discount.",
      },
      {
        view: DISCOUNT_CONT,
        note: "Free months at the end, or a lower rate kept while they stay.",
      },
      {
        view: WAIVED_FEE,
        note: "A big fee for month to month, waived for a year. Quit early, pay it.",
      },
    ],
  },
];

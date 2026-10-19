/**
 * The Offers and Numbers pages' reads (`../../modules/offers`, `../../modules/numbers`, the
 * pipelines tabs) and the books pages that moved to Numbers. Synthetic: made-up offers, plans
 * and amounts. `TERMS_CALLS` keeps what "Propose version" sent, so a story can check the form.
 */
import type { RecorderState } from "@wren/calendar/recorder";
import type { Cell } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

/** The writes the terms form sent since the last `forgetTermsCalls()`. */
export const TERMS_CALLS: Record<string, unknown>[] = [];
export const forgetTermsCalls = () => TERMS_CALLS.splice(0);

const day = (days: number) => ago(days).slice(0, 10);
const cad = (amount: number) => ({ amount, currency: "CAD" });

const terms = (
  id: number,
  offer: string,
  plan: string,
  number: number,
  from: number,
  state: "live" | "upcoming" | "older",
  read: string,
  why: string,
): Row => ({
  id,
  offer,
  plan,
  number,
  effectiveFrom: day(from),
  state,
  terms: read,
  why,
  createdAt: ago(Math.abs(from) + 2),
  createdBy: "Ada North",
});

const TERMS: Row[] = [
  terms(
    1,
    "starter",
    "standard",
    1,
    120,
    "older",
    "setup 900.00 USD, 450.00 USD a month, due in 7 days",
    "First terms.",
  ),
  terms(
    2,
    "starter",
    "standard",
    2,
    30,
    "live",
    "setup 1,000.00 USD, 500.00 USD a month, due in 7 days",
    "Price rose with the new scope.",
  ),
  terms(
    3,
    "starter",
    "standard",
    3,
    -14,
    "upcoming",
    "setup 1,000.00 USD, 550.00 USD a month, due in 7 days",
    "Hosting costs more from next month.",
  ),
  terms(
    4,
    "starter",
    "flat",
    1,
    60,
    "live",
    "setup 2,500.00 USD, 90 days, due in 14 days",
    "A fixed project.",
  ),
  terms(
    5,
    "growth",
    "share",
    1,
    45,
    "live",
    "400.00 USD per unit, up to 4,000.00, due in 7 days",
    "Pay for booked calls.",
  ),
];

const offer = (id: string, name: string, version: number, plans: number, open: number): Row => ({
  id,
  name,
  status: "live",
  version,
  audience: id === "starter" ? "Small trades firms" : "Local services",
  promise: null,
  livePlans: plans,
  openJourneys: open,
  hash: "9f2c41a0b7e3",
  syncedAt: ago(20),
  syncedBy: "Ada North",
  why: "Synced from the registry.",
});

type EntryRow = [string, string, string, string, string, string | null, number, number, number];

const ENTRIES: Row[] = (
  [
    ["sales", "Sales funnel", "mail", "outbound", "email", "Spring list", 3, 11, 2],
    ["sales", "Sales funnel", "ads1", "ads", "ads", "Winter ads", 1, 6, 5],
    ["sales", "Sales funnel", "call", "booking", "web", null, 0, 4, 9],
    ["welcome", "Welcome funnel", "web", "form", "web", null, 1, 3, 1],
  ] satisfies EntryRow[]
).map(([funnel, funnelName, entry, kind, channel, campaign, open, all, last], i) => ({
  id: `${funnel}/${entry}`,
  funnelName,
  funnel,
  entry,
  kind,
  channel,
  campaign,
  openJourneys: open,
  journeys: all,
  lastArrival: ago(last + i * 0.1),
}));

const num = (
  id: string,
  kind: "stage" | "entry" | "offer",
  label: string,
  funnel: string,
  position: number,
  n: [number, number, number, number],
  more: Record<string, Cell> = {},
): Row => {
  const [entered, skipped, reached, advanced] = n;
  return {
    id,
    kind,
    label,
    funnel,
    position,
    entered,
    skipped,
    reached,
    advanced,
    conversion: reached ? advanced / reached : null,
    medianSeconds: 86_400 * (position + 1) * 2,
    opened: null,
    deals: null,
    collected: null,
    scheduled: null,
    cost: null,
    last: day(2),
    ...more,
  };
};

const NUMBERS: Row[] = [
  num("sales/engaged", "stage", "Engaged", "sales", 0, [14, 0, 14, 9]),
  num("sales/booked", "stage", "Booked", "sales", 1, [9, 1, 10, 4]),
  num("sales/signed", "stage", "Signed", "sales", 2, [4, 0, 4, 4]),
  num("sales/mail", "entry", "Spring list", "sales", 0, [0, 0, 0, 0], {
    opened: 11,
    deals: 2,
    collected: cad(1_000),
  }),
  num("sales/ads1", "entry", "Winter ads", "sales", 1, [0, 0, 0, 0], {
    opened: 6,
    deals: 1,
    collected: cad(0),
    cost: 4,
  }),
  num("offer/starter", "offer", "Starter", "", 0, [0, 0, 0, 0], {
    opened: 17,
    deals: 3,
    collected: cad(2_500),
    scheduled: cad(1_500),
  }),
];

const month = (i: number): Row => ({
  id: i + 1,
  month: day(30 * (i + 1)),
  mrr: cad(3_000 - i * 400),
  revenue: cad(3_200 - i * 380),
  spend: cad(1_400 + i * 60),
  acquisition: cad(900),
  delivery: cad(300),
  overhead: cad(200),
  paying: 6 - i,
  payingStart: 6 - i,
  newClients: 1,
  churned: i === 1 ? 1 : 0,
  arpa: cad(500),
  arpa3: cad(490),
  grossMargin: 0.62 - i * 0.03,
  cac3: cad(900),
  cac6: cad(950),
  cac12: cad(1_000),
  logoChurn: 0.04,
  revenueChurn: 0.03,
  ltv: cad(9_000),
  ltvCac: 9.5,
  payback: 2.1,
  realizedLtv: cad(2_500),
  realizedLtvAll: cad(4_100),
});

const CHANNELS: Row[] = ["email", "ads", "content"].map((channel, i) => ({
  id: i + 1,
  channel,
  month: day(0),
  age: "true",
  spend: cad(600 - i * 150),
  leads: 120 - i * 30,
  sends: 900 - i * 300,
  replies: 24 - i * 8,
  interested: 6 - i * 2,
  booked: 3 - i,
  newClients: i === 0 ? 1 : 0,
  perLead: cad(5),
  perSend: cad(1),
  perReply: cad(25),
  perInterested: cad(100),
  perBooked: cad(200),
  cac3: cad(900),
  cac6: cad(950),
  cac12: cad(1_000),
}));

const COHORTS: Row[] = [0, 1, 2].map((since) => ({
  id: since + 1,
  cell: `${day(90).slice(0, 7)}, ${since}`,
  cohort: day(90),
  monthsSince: since,
  clients: 3,
  paying: 3 - since,
  stillPaying: (3 - since) / 3,
  revenue: cad(1_500 - since * 300),
  revenueKept: 1 - since * 0.2,
}));

/** The rows by record, for `recordsAnswers`. */
export const OFFER_ROWS: Record<string, Row[]> = {
  "pipeline.offer": [offer("starter", "Starter", 2, 2, 5), offer("growth", "Growth", 1, 1, 1)],
  "pipeline.terms": TERMS,
  "pipeline.entry": ENTRIES,
  "pipeline.number": NUMBERS,
  "pipeline.deal": [
    {
      id: "d1",
      name: "Cai Moreno",
      offer: "starter",
      plan: "standard",
      status: "open",
      collected: cad(0),
      scheduled: cad(1_000),
      funnel: "sales",
      entry: "mail",
      signedAt: ago(4),
      endsAt: null,
    },
    {
      id: "d2",
      name: "Eli Brandt",
      offer: "starter",
      plan: "flat",
      status: "won",
      collected: cad(2_500),
      scheduled: cad(0),
      funnel: "sales",
      entry: "ads1",
      signedAt: ago(20),
      endsAt: null,
    },
  ],
  "books.month": [0, 1, 2, 3].map(month),
  "books.channel": CHANNELS,
  "books.cohort": COHORTS,
};

/** An offer's detail: its versions, newest first. */
export const OFFER_DETAIL: Record<string, (row: Row) => object> = {
  "pipeline.offer": (row) => ({
    versions: Array.from({ length: Number(row.version) }, (_, i) => ({
      number: Number(row.version) - i,
      hash: "9f2c41a0b7e3",
      why: i === 0 ? "Promise reworded." : "First version.",
      at: ago(20 + i * 40),
      by: "Ada North",
    })),
  }),
  "pipeline.terms": () => ({
    body: { currency: "usd", setupCents: 100_000, monthlyCents: 50_000, payDays: 7 },
  }),
};

/** The terms form's write, as the server answers when a version is added; the calls tab's recorder. */
export const OFFER_ANSWERS: Answers = {
  "calendar/recorder": {
    recording: false,
    since: null,
    booking: null,
    who: null,
    by: null,
    next: null,
  } satisfies RecorderState,
  "pipeline/termsAdd": (b) => {
    TERMS_CALLS.push(b);
    return { offer: b.offer, plan: b.plan, version: 4, from: b.from };
  },
};

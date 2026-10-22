/**
 * Sample data for the Wren pages that draw lists with `Rows`: Ask, made workflows, the home's
 * client health, automations, the dossier, a split's ended arms. Synthetic; the repo is public.
 * `rowsOf` puts hand-made rows in front of the shared records answers for one record.
 */
import type { AutomationRow } from "@wren/core/automations";
import type { RecordsPage } from "@wren/core/records/serve";
import type { PageDetail } from "@wren/sites/detail";
import type { Answers } from "../api.js";
import { ago } from "./shell.js";

/** Hours ago, as the ISO time the server sends. */
const hrs = (h: number) => ago(h / 24);

type Reply = (body: Record<string, unknown>) => unknown;

const page = (record: string, rows: object[], counts: Record<string, number> = {}) =>
  ({
    record,
    view: null,
    rows,
    total: rows.length,
    counts,
    next: null,
    totals: {},
  }) as unknown as RecordsPage;

/**
 * `base`'s records answers with `rows` in front for each record named, under every product that
 * serves it. Other records, and `recordsGet`, stay as `base` has them.
 */
export function rowsOf(
  base: Answers,
  product: string,
  rows: Record<string, { rows: object[]; counts?: Record<string, number> }>,
): Answers {
  const was = base[`${product}/recordsList`] as Reply;
  return {
    [`${product}/recordsList`]: (b: Record<string, unknown>) => {
      const mine = rows[String(b.record)];
      return mine ? page(String(b.record), mine.rows, mine.counts) : was(b);
    },
  };
}

/**
 * `base`'s `recordsGet` with `detail` (a record's page extras) on the answer for `record`, under
 * each product that may serve it.
 */
export const detailOf = (base: Answers, record: string, detail: object): Answers =>
  Object.fromEntries(
    ["console", "sites"].map((p) => [
      `${p}/recordsGet`,
      ((b: Record<string, unknown>) => {
        const was = (base[`${p}/recordsGet`] as Reply)(b) as object;
        return b.record === record ? { ...was, detail } : was;
      }) as Reply,
    ]),
  );

export const ASK_ROWS = [
  {
    id: 1,
    question: "How many replies came in this week, and from which campaign?",
    answer:
      "Eleven replies. Nine came from `apps/worker/src/campaigns.ts` winter run; two from the spring list.",
    state: "answered",
    by: "Ada North",
    page: "/content/drafts",
    asked: hrs(3),
    took: 42,
  },
  {
    id: 2,
    question: "Why did the Monday digest skip Fenwick & Sons?",
    answer: null,
    state: "thinking",
    by: "Bo Fenwick",
    page: "/ask/questions",
    asked: hrs(0.1),
    took: null,
  },
  {
    id: 3,
    question: "Which sends bounced last night?",
    answer: "I could not read prod: the read only login timed out.",
    state: "failed",
    by: "Ada North",
    page: "/",
    asked: hrs(26),
    took: 9,
  },
];

export const MADE_FLOWS = [
  {
    id: "wf-quote",
    live: true,
    draft: false,
    nodes: 6,
    at: hrs(72),
    made: { name: "Quote follow-up" },
  },
  { id: "wf-win", live: true, draft: true, nodes: 4, at: hrs(30), made: { name: "Win-back text" } },
  {
    id: "wf-new",
    live: false,
    draft: true,
    nodes: 3,
    at: hrs(2),
    made: { name: "Review request" },
  },
];

export const HEALTH_ROWS = [
  {
    id: "acme",
    name: "Acme Plumbing",
    score: 41,
    weakest: "Replies",
    hand: "no",
    risks: 2,
    stale: 1,
    staleParts: "Sends",
    state: "risk",
  },
  {
    id: "northwind",
    name: "Northwind",
    score: 55,
    weakest: "Bookings",
    hand: "yes",
    risks: 0,
    stale: 0,
    staleParts: "",
    state: "risk",
  },
];
export const FLAG_ROWS = [
  {
    id: 7,
    what: "Sender domain flagged",
    name: "Acme Plumbing",
    owner: "Ada North",
    raised: hrs(5),
  },
];

const auto = (r: Partial<AutomationRow> & Pick<AutomationRow, "id" | "name" | "kind" | "ref">) =>
  ({
    trigger: "A lead replies",
    state: "on",
    health: "ok",
    runs: 12,
    failed: 0,
    waiting: 0,
    lastAt: hrs(3),
    nextAt: null,
    error: null,
    ...r,
  }) as AutomationRow;

/** A fresh table each story: a flip changes its row, as the server would. */
export function automationRows(): AutomationRow[] {
  return [
    auto({ id: "workflow:welcome", name: "Welcome email", kind: "workflow", ref: "welcome" }),
    auto({
      id: "workflow:quote",
      name: "Quote follow-up",
      kind: "made",
      ref: "wf-quote",
      state: "off",
      runs: 0,
      lastAt: null,
    }),
    auto({
      id: "workflow:win",
      name: "Win-back text",
      kind: "made",
      ref: "wf-win",
      state: "off",
      trigger: "A lead goes quiet for 30 days",
    }),
    auto({
      id: "keyword:guide",
      name: "Comment “GUIDE” → DM",
      kind: "keyword",
      ref: "k1",
      trigger: "A comment with GUIDE on Instagram",
      health: "failing",
      failed: 3,
      error: "Instagram refused the DM: the account is rate limited.",
    }),
    auto({
      id: "loop:mail",
      name: "Mail sync",
      kind: "loop",
      ref: "mail",
      trigger: "Every 5 minutes",
      nextAt: hrs(-0.1),
    }),
    auto({
      id: "reply:email",
      name: "Email auto-reply",
      kind: "reply",
      ref: "email",
      state: "suggest",
      runs: null,
      lastAt: null,
    }),
  ];
}

export const DOSSIER = {
  facts: [
    {
      what: "size",
      text: "About 40 people across two crews.",
      source: "https://example.com/about",
      via: "Company site",
      seen: hrs(48),
    },
    {
      what: "service area",
      text: "Roofing and gutters within 60 miles of Denver.",
      source: null,
      via: "Google Maps",
      seen: hrs(100),
    },
  ],
  posts: [
    {
      site: "Facebook",
      kind: "post",
      text: "Storm season is here. Book a free roof check this week.",
      url: "https://example.com/post/1",
      published: hrs(70),
    },
  ],
  people: [
    {
      name: "Cai Moreno",
      title: "Owner",
      origin: "Company site",
      facts: [
        {
          what: "hobby",
          text: "Coaches youth soccer.",
          source: "https://example.com/cai",
          via: "LinkedIn",
          seen: hrs(60),
        },
      ],
    },
  ],
};

/** A data page with an ended split: B and C came down or wait to; D can be retired. */
export const ENDED_SPLIT: PageDetail = {
  source: "data",
  template: null,
  draft: null,
  live: 1,
  waiting: null,
  retiring: false,
  versions: [],
  preview: null,
  repoPath: null,
  notes: null,
  kit: null,
  days: [],
  sources: [],
  ads: [],
  variants: [],
  splitWith: [],
  split: {
    split: {
      id: "s1",
      goal: "forms",
      state: "stopped",
      winner: null,
      endedAt: hrs(30),
      updatedAt: hrs(30),
      arms: [
        {
          label: "A",
          page: "p1",
          weight: 50,
          slug: "roof",
          title: "Roof check",
          status: "live",
          retiring: false,
        },
        {
          label: "B",
          page: "p2",
          weight: 25,
          slug: "roof-b",
          title: "Roof check, short",
          status: "live",
          retiring: false,
        },
        {
          label: "C",
          page: "p3",
          weight: 25,
          slug: "roof-c",
          title: "Roof check, quote",
          status: "live",
          retiring: false,
        },
        {
          label: "D",
          page: "p4",
          weight: 0,
          slug: "roof-d",
          title: "Roof check, call",
          status: "retired",
          retiring: false,
        },
        {
          label: "E",
          page: "p5",
          weight: 0,
          slug: "roof-e",
          title: "Roof check, form",
          status: "live",
          retiring: true,
        },
      ],
    },
    arms: [],
    call: { words: "Too early to call", kind: "too_early", leader: null, sure: [], more: 0 },
  },
} as unknown as PageDetail;

/** The root workflow as the console draws it, two steps. */
export const DRAWN = {
  workflow: {
    id: "wren",
    name: "Wren",
    in: [],
    out: [],
    nodes: [
      { id: "enrich", uses: null, name: "Read the company", note: null, ready: "ready" },
      { id: "send", uses: null, name: "Send the first email", note: null, ready: "ready" },
    ],
    wires: [],
  },
};

export const EXEC_ROWS = [
  {
    id: "x1",
    title: "Ada North",
    subject: "lead:1",
    state: "waiting",
    node: "send",
    due: hrs(-5),
    until: "reply",
    entered: hrs(30),
  },
  {
    id: "x2",
    title: "Bo Fenwick",
    subject: "lead:2",
    state: "failed",
    node: "enrich",
    due: null,
    until: null,
    entered: hrs(8),
  },
  {
    id: "x3",
    title: "Cai Moreno",
    subject: "lead:3",
    state: "done",
    node: "send",
    due: null,
    until: null,
    entered: hrs(80),
  },
];

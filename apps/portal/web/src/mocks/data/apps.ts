/**
 * Each app's own first read, past the records pages: the reactivation run, the delivery home,
 * learn's shelves, notes, the calendar, deals' board. Typed by what the page reads, so a change
 * to the answer fails the typecheck here. Synthetic data only.
 */

import type { TemplateListRow } from "@wren/core/templates/console";
import type { NotesApi } from "@wren/notes/console";
import type { DeliveryHome, Overview } from "../../api.js";
import type { Browsed, Card, Home, Rail, SourceRow } from "../../modules/learn/api.js";
import type { NotesHome } from "../../modules/notes/api.js";
import { type Answers, serve } from "../api.js";
import { CLIENT } from "./me.js";
import { ago } from "./shell.js";

const OVERVIEW: Overview = {
  people: 412,
  companies: 188,
  lookedUp: 390,
  moved: 61,
  stillThere: 301,
  left: 28,
  hiringCompanies: 14,
  atHiring: 22,
  briefs: 18,
  top: [
    {
      personId: 1,
      name: "Ada North",
      firm: "Northwind",
      score: 92,
      reasons: [{ reason: "Bought twice, last time 14 months ago.", points: 40, cites: [] }],
      brief: "Ask about the spring service plan.",
    },
    {
      personId: 2,
      name: "Bo Fenwick",
      firm: "Fenwick & Sons",
      score: 81,
      reasons: [{ reason: "Opened the last two emails.", points: 25, cites: [] }],
      brief: null,
    },
  ],
  pipeline: {
    steps: (
      [
        ["list", 412, null, "done"],
        ["emails", 390, 412, "done"],
        ["where", 390, 412, "done"],
        ["hiring", 14, null, "done"],
        ["score", 390, 390, "done"],
        ["briefs", 18, 20, "next"],
        ["drafts", 6, 20, "waiting"],
        ["approve", 4, 6, "yours"],
        ["sent", 0, null, "idle"],
        ["replies", 0, null, "idle"],
      ] as const
    ).map(([id, count, of, state]) => ({ id, count, of, state, resumesAt: null, parked: 0 })),
    sends: true,
  },
};

const comment = (id: number, author: string, body: string, fromWren: boolean, days: number) => ({
  id,
  author,
  body,
  fromWren,
  at: ago(days),
});

const HOME: DeliveryHome = {
  engagements: [
    {
      id: 1,
      offer: {
        id: "reactivation",
        name: "Reactivation",
        app: "reactivation",
        promise: "Booked calls from past customers.",
        guarantee: "Ten calls or the next month is free.",
        youGet: ["A list of past customers worth a call", "Messages written and sent for you"],
        youGive: ["Your customer list", "Ten minutes a week to approve messages"],
      },
      paperwork: {
        contract: { issuedAt: ago(95), signedBy: "owner@acme.example", signedAt: ago(94) },
        setupPaid: true,
        access: [
          {
            id: 1,
            system: "Google Workspace",
            scope: "Send mail as the owner",
            why: "Messages go out from your address.",
            revoke: "Remove the app in Google admin.",
            status: "granted",
            note: null,
            answeredBy: "owner@acme.example",
            answeredAt: ago(93),
          },
        ],
      },
      startsOn: ago(90).slice(0, 10),
      status: "active",
      steps: [
        {
          state: "done",
          name: "List cleaned",
          key: "list",
          plannedFrom: ago(90).slice(0, 10),
          plannedTo: ago(80).slice(0, 10),
          dueOn: null,
          doneOn: ago(82).slice(0, 10),
          slipReason: null,
          promised: ["Every past customer, once each"],
        },
        {
          state: "now",
          name: "First messages out",
          key: "send",
          plannedFrom: ago(10).slice(0, 10),
          plannedTo: ago(-5).slice(0, 10),
          dueOn: ago(-5).slice(0, 10),
          doneOn: null,
          slipReason: null,
          promised: ["Twenty messages approved and sent"],
        },
      ],
      updates: [
        {
          id: 1,
          author: "Sam Rivera",
          body: "Six drafts wait for your approval.",
          internal: false,
          step: "send",
          at: ago(1),
          hidden: false,
          comments: [comment(1, "owner@acme.example", "Will look tonight.", false, 0.8)],
        },
      ],
      deliverables: [
        {
          id: 1,
          status: "waiting",
          title: "First message drafts",
          kind: "doc",
          url: null,
          version: 1,
          decidedBy: null,
          decisionNote: null,
          step: "send",
          file: null,
          at: ago(1),
          decidedAt: null,
          comments: [],
        },
      ],
      asks: [
        {
          id: 1,
          answeredBy: null,
          dueOn: ago(-2).slice(0, 10),
          text: "Which service do you want to lead with?",
          answer: null,
          step: "send",
          file: null,
          answeredAt: null,
          overdue: false,
        },
      ],
      results: [
        { key: "calls", label: "Calls booked", unit: "calls", value: 3, note: null, at: ago(2) },
      ],
      pulse: { week: ago(3).slice(0, 10), mine: null, scores: [8, 9] },
      moments: [],
      next: [
        {
          id: "reviews",
          name: "Reviews",
          promise: "More five-star reviews.",
          pitch: "Ask every happy customer, at the right time.",
          interested: false,
        },
      ],
    },
  ],
};

const card = (id: number, title: string, type: Card["type"], days: number): Card =>
  ({
    id,
    title,
    type,
    url: `https://example.com/learn/${id}`,
    thumbnail: null,
    duration: type === "youtube" ? 840 : null,
    chars: 4200,
    source: { id: 1, name: "Trades Growth", kind: "youtube", avatar: null },
    creator: "Trades Growth",
    score: 8,
    summary: "A clear script for a first text to an old customer.",
    status: "unread",
    state: "ready",
    starred: false,
    pinned: false,
    later: false,
    position: null,
    collectionId: null,
    tags: ["reactivation"],
    saved: false,
    at: ago(days),
  }) satisfies Card;

const CARDS = [
  card(1, "Five ways to win back old customers", "youtube", 0.2),
  card(2, "The follow-up most shops skip", "blog", 1),
  card(3, "Pricing a service plan", "newsletter", 3),
];

const LEARN_HOME: Home = {
  shelves: [
    { type: "youtube", total: 1, items: CARDS.slice(0, 1) },
    { type: "blog", total: 2, items: CARDS.slice(1) },
  ],
  continue: CARDS.slice(1, 2),
  top: CARDS.slice(0, 2),
  sops: [],
};

/** Feed's "Following" read: the newest posts of the sources followed. */
const BROWSED: Browsed = {
  place: "all",
  sort: "newest",
  items: CARDS,
  more: false,
  total: CARDS.length,
  types: { youtube: 1, blog: 1, newsletter: 1 },
  sources: [{ id: 1, name: "Trades Growth", kind: "youtube", avatar: null, n: 3 }],
};

const RAIL: Rail = {
  places: { inbox: 3, all: 3, later: 0, starred: 0, saved: 0, archived: 0 },
  collections: [{ id: 1, name: "Sales", parentId: null, n: 2 }],
  sources: [
    {
      kind: "youtube",
      sources: [
        {
          id: 1,
          name: "Trades Growth",
          kind: "youtube",
          avatar: null,
          stopped: false,
          failure: null,
          fresh: 1,
        },
      ],
    },
  ],
  tags: [{ tag: "reactivation", n: 3 }],
};

/** Sources, the page's own read: one followed channel, nothing failing. */
const SOURCES: { may: boolean; kinds: { kind: SourceRow["kind"]; sources: SourceRow[] }[] } = {
  may: true,
  kinds: [
    {
      kind: "youtube",
      sources: [
        {
          id: 1,
          name: "Trades Growth",
          kind: "youtube",
          avatar: null,
          url: "https://video.example.com/@tradesgrowth",
          page: null,
          tell: "top",
          alert: null,
          failure: null,
          stopped: false,
          fetchedAt: ago(0.1),
          items: 3,
          fresh: 1,
          top: 1,
          last: ago(0.2),
        },
      ],
    },
  ],
};

const note = (id: string, title: string, kind: "note" | "task", days: number) => ({
  id,
  name: title,
  title,
  kind,
  owner: "owner@acme.example",
  mine: true,
  via: "person" as const,
  general: "workspace" as const,
  parentId: null,
  starred: id === "n1",
  createdAt: ago(days + 2),
  updatedAt: ago(days),
  editedBy: null,
  seenAt: ago(days),
  archived: false,
  excerpt: "Dates, offer and who sends what.",
  home: "/notes/home",
});

const NOTES: NotesHome = {
  notes: [
    note("n1", "Spring promo plan", "note", 0.5),
    note("n2", "Call back the Brandt job", "task", 2),
    note("n3", "Crew schedule for November", "note", 4),
  ],
  me: "owner@acme.example",
  workspace: CLIENT.id,
  canWrite: true,
  canManage: true,
  train: false,
};

/**
 * Notes that remember their stars, as the server does: Star writes, and the next read of the list
 * shows it. `reset` puts the first note back, for a story's start.
 */
export function starring() {
  const on = new Set(["n1"]);
  return {
    reset: () => {
      on.clear();
      on.add("n1");
    },
    answers: serve<NotesApi>("notes", {
      home: () => ({ ...NOTES, notes: NOTES.notes.map((n) => ({ ...n, starred: on.has(n.id) })) }),
      star: (b) => {
        if (b.on === false) on.delete(String(b.id));
        else on.add(String(b.id));
        return { starred: b.on !== false };
      },
    }),
  };
}

/** The week of the stories' clock: two booked calls, open hours each weekday. */
const day = (d: number, h: number) =>
  new Date(Date.parse("2026-10-12T00:00:00Z") + d * 864e5 + h * 36e5).toISOString();
const RANGE = {
  zone: "America/Chicago",
  length: 30,
  open: [0, 1, 2, 3, 4].map((d) => ({ start: day(d, 14), end: day(d, 22) })),
  calls: [
    {
      id: 1,
      start: day(1, 15),
      end: day(1, 15.5),
      name: "Ada North",
      offer: "Reactivation",
      state: "booked",
      outcome: null,
      meet: null,
    },
    {
      id: 2,
      start: day(3, 18),
      end: day(3, 18.5),
      name: "Bo Fenwick",
      offer: null,
      state: "booked",
      outcome: null,
      meet: null,
    },
  ],
  page: "https://cal.example.com/acme",
  sends: true,
  connected: true,
};

const template = (
  id: number,
  name: string,
  kind: TemplateListRow["kind"],
  status: TemplateListRow["status"],
): TemplateListRow => ({
  ref: `reactivation/${name.toLowerCase().replace(/\W+/g, "-")}`,
  app: "reactivation",
  at: ago(id),
  editable: true,
  id,
  folder: "Reactivation",
  status,
  live: 1,
  draft: status === "edited" ? 2 : null,
  waiting: status === "waiting" ? 2 : null,
  newestDefault: 1,
  by: null,
  origin: null,
  words: "Hi {{first}}, it has been a while since we fixed your…",
  kind,
  system: "",
  name,
});

export const APP_ANSWERS: Answers = {
  "reactivation/overview": OVERVIEW,
  "delivery/home": HOME,
  "learn/home": LEARN_HOME,
  "learn/rail": RAIL,
  "learn/sources": SOURCES,
  "learn/browse": BROWSED,
  "learn/unseen": { n: 1 },
  // Thumbnails are null, so a grant is never used: Wren's one, or a client's per item.
  "media/grant": (b) => (b.client ? { grants: {} } : { grant: "fake" }),
  "notes/home": NOTES,
  // A record's panel: no notes link to it, no issues raised on it.
  "notes/backlinks": { notes: [] },
  "console/issues": [],
  "calendar/range": RANGE,
  "payments/status": {
    connected: true,
    live: true,
    webhook: "api",
    url: "https://app.example.com/stripe/acme",
    keyStore: true,
    last4: "4242",
    managed: "self",
    approves: false,
    drift: 0,
  },
  "marketing/inboxAuto": {
    modes: { text: "suggest", email: "suggest", dm: "off", comment: "auto" },
    held: false,
  },
  "templates/list": {
    templates: [
      template(1, "First text", "sms", "default"),
      template(2, "Second email", "email", "edited"),
      template(3, "Booked reply", "email", "waiting"),
    ],
  },
};

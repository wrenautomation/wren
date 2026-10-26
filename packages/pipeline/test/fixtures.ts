/**
 * Synthetic shapes for the pipeline tests. One place, so no test builds its own copy.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { graphOf, metroOf } from "../src/convert.js";
import type { MetroBody } from "../src/metro.js";
import {
  depthOf,
  type ShapeBody,
  type ShapeCheckContext,
  type ShapeEdge,
  type ShapeNode,
} from "../src/model.js";
import { type ShapeVersion, shapeVersions } from "../src/schema.js";
import { starterShape } from "../src/starter.js";
import { newestShape } from "../src/store.js";

export const TRIGGERS = new Set([
  "trigger.reply",
  "trigger.booking",
  "trigger.document",
  "trigger.touch",
  "trigger.segment",
  "trigger.source",
]);

export const ctx = (over: Partial<ShapeCheckContext> = {}): ShapeCheckContext => ({
  triggers: TRIGGERS,
  group: (id) => (id === "7" ? { active: true } : id === "8" ? { active: false } : undefined),
  source: (id) => (id === "import:12" ? { exists: true } : undefined),
  ...over,
});

/** A flow edge with the default id. */
export const flow = (from: string, to: string, over: Partial<ShapeEdge> = {}): ShapeEdge => ({
  id: `${from}_to_${to}`,
  from,
  to,
  kind: "flow",
  ...over,
});

export const loop = (from: string, to: string): ShapeEdge => flow(from, to, { kind: "loop" });

export const NODES: ShapeNode[] = [
  { id: "yt", kind: "source", name: "YouTube", via: "organic", channel: "youtube" },
  { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
  {
    id: "engaged",
    kind: "step",
    name: "Engaged",
    action: "reply",
    advance: [{ trigger: "trigger.reply" }],
  },
  {
    id: "booked",
    kind: "step",
    name: "Booked",
    action: "book",
    advance: [{ trigger: "trigger.booking" }],
  },
  { id: "proposal", kind: "step", name: "Proposal", action: "proposal", advance: [] },
  {
    id: "signed",
    kind: "offer",
    name: "Signed",
    offer: "offer-a",
    advance: [{ trigger: "trigger.document" }],
  },
  { id: "standard", kind: "plan", name: "Standard", terms: "standard", advance: [] },
];

/** Two sources into a four step path, an offer, and a plan under it. */
export const shape = (over: Partial<ShapeBody> = {}): ShapeBody => ({
  name: "Test shape",
  nodes: NODES.map((n) => ({ ...n })),
  edges: [
    flow("yt", "engaged"),
    flow("mail", "engaged"),
    flow("engaged", "booked"),
    flow("booked", "proposal"),
    flow("proposal", "signed"),
    flow("signed", "standard"),
  ],
  ...over,
});

/**
 * The metro body a graph is saved as. Every stored body is a metro body (C1 part 4), so a
 * test that seeds a graph shape saves `asMetro(graph)`: station ids are the node ids and track ids
 * the edge ids, so journeys and deals keep their place. Throws what `metroOf` refuses.
 */
export const asMetro = (graph: ShapeBody): MetroBody => {
  const made = metroOf(graph);
  if (!made.ok) throw new Error(`asMetro: ${made.errors.join(" ")}`);
  return made.body;
};

/**
 * A graph version as a database from before 0315 holds it: `saveShape` and the metro-only trigger
 * both refuse a graph body now, so this writes the row with that trigger off. Only the tests of
 * `convertShape`, the graph undo and the graph edits use it, for the graph the convert starts from.
 */
export async function seedGraph(
  db: Queryable,
  body: ShapeBody,
  note = "graph",
): Promise<ShapeVersion> {
  const last = await newestShape(db);
  await db.execute(
    sql`alter table pipeline.shape_versions disable trigger shape_versions_metro_only`,
  );
  try {
    const [row] = await db
      .insert(shapeVersions)
      .values({
        number: (last?.number ?? 0) + 1,
        body,
        run: body,
        depths: depthOf(body),
        note,
        parent: last?.number ?? null,
        createdBy: "t",
      })
      .returning();
    if (!row) throw new Error("seedGraph: insert returned nothing");
    return row;
  } finally {
    await db.execute(
      sql`alter table pipeline.shape_versions enable trigger shape_versions_metro_only`,
    );
  }
}

/** The starter as the graph the runtime runs: its edges in the order `graphOf` lists them. */
export const starterGraph = (): ShapeBody => graphOf(starterShape().body);

/** A shape with extra nodes and edges added to `shape()`. */
export const grown = (nodes: ShapeNode[], edges: ShapeEdge[]): ShapeBody => {
  const base = shape();
  return { ...base, nodes: [...base.nodes, ...nodes], edges: [...base.edges, ...edges] };
};

/**
 * A graph like a real business, with synthetic names: eight social sources into one comment step,
 * a DM source into the dm step, an ads source into the visit step, a partner source straight to
 * the offer node, a chain of eight steps, the offer and two plans, and loop edges from five steps
 * back to dm.
 */
export const wideShape = (): ShapeBody => {
  const social = ["yt", "ig", "x", "tiktok", "linkedin", "facebook", "reddit", "threads"];
  const step = (
    id: string,
    action: Extract<ShapeNode, { kind: "step" }>["action"],
    advance: Extract<ShapeNode, { kind: "step" }>["advance"] = [],
  ): ShapeNode => ({ id, kind: "step", name: id.toUpperCase(), action, advance });
  return {
    name: "Wide shape",
    nodes: [
      ...social.map(
        (id): ShapeNode => ({
          id,
          kind: "source",
          name: id.toUpperCase(),
          via: "organic",
          channel: id,
        }),
      ),
      { id: "dm_in", kind: "source", name: "DM in", via: "outbound", channel: "instagram" },
      { id: "ads", kind: "source", name: "Ads", via: "ads", campaign: "spring" },
      { id: "partner", kind: "source", name: "Partner", via: "referral" },
      step("comment", "comment", [
        { trigger: "trigger.touch", with: { kind: "comment", direction: "ours" } },
      ]),
      step("reply", "reply", [{ trigger: "trigger.reply" }]),
      step("dm", "dm"),
      step("cta", "cta"),
      step("visit", "visit"),
      step("book", "book", [{ trigger: "trigger.booking", with: { on: "booked" } }]),
      step("held", "held"),
      step("proposal", "proposal", [{ trigger: "trigger.document", with: { on: "viewed" } }]),
      { id: "offer", kind: "offer", name: "Offer", offer: "offer-a", advance: [] },
      {
        id: "plan_a",
        kind: "plan",
        name: "Plan A",
        terms: "standard",
        advance: [{ trigger: "trigger.document", with: { on: "signed" } }],
      },
      { id: "plan_b", kind: "plan", name: "Plan B", terms: "premium", advance: [] },
    ],
    edges: [
      ...social.map((id) => flow(id, "comment")),
      flow("dm_in", "dm"),
      flow("ads", "visit"),
      flow("partner", "offer"),
      flow("comment", "reply"),
      flow("reply", "dm"),
      flow("dm", "cta"),
      flow("cta", "visit"),
      flow("visit", "book"),
      flow("book", "held"),
      flow("held", "proposal"),
      flow("proposal", "offer"),
      flow("offer", "plan_a"),
      flow("offer", "plan_b"),
      ...["cta", "visit", "book", "held", "proposal"].map((id) =>
        flow(id, "dm", { kind: "loop", label: "no answer" }),
      ),
    ],
  };
};

/**
 * A hand-made metro body with every station kind, track kind and logic kind, every attach kind,
 * and one shared flow that its link station opens. It passes `checkMetro` with `ctx()`. The
 * runtime cannot run it (`lowerable` says why).
 */
export const metroShape = (): MetroBody => ({
  model: "metro",
  name: "Metro shape",
  lines: [
    { id: "social", label: "Social", tier: "out", entry: { via: "organic", channel: "youtube" } },
    {
      id: "cold",
      label: "Cold",
      tier: "out",
      entry: { via: "outbound", channel: "email", campaign: "spring" },
    },
    { id: "list", label: "List", tier: "out", entry: { via: "sourced", source: "import:12" } },
    {
      id: "team",
      label: "Team",
      tier: "out",
      entry: { via: "group", segment: "7", parked: true },
    },
    { id: "nurture", label: "Nurture", tier: "front", colour: 2 },
    {
      id: "growth",
      label: "Growth",
      tier: "core",
      offer: "offer-a",
      colour: 0,
      attach: [
        { kind: "sop", ref: "growth-playbook", label: "Playbook" },
        { kind: "link", ref: "https://example.com/growth" },
        { kind: "page", ref: "growth-landing" },
      ],
    },
    {
      id: "retain",
      label: "Retain",
      tier: "core",
      offer: "offer-b",
      colour: 1,
      planned: true,
    },
  ],
  stations: [
    { id: "social", label: "Social", kind: "att", line: "social", column: "marketing" },
    { id: "cold", label: "Cold", kind: "att", line: "cold", column: "marketing" },
    { id: "list", label: "List", kind: "att", line: "list", column: "marketing" },
    { id: "team", label: "Team", kind: "att", line: "team", column: "marketing" },
    { id: "hub", label: "First touch", kind: "hub", column: "marketing" },
    {
      id: "nurture_start",
      label: "Nurture start",
      kind: "att",
      line: "nurture",
      column: "marketing",
      action: "email",
      advance: [],
      retries: 2,
    },
    {
      id: "reply",
      label: "Reply",
      kind: "att",
      line: "growth",
      column: "marketing",
      action: "reply",
      advance: [{ trigger: "trigger.reply" }],
      research: "light",
      idleDays: 7,
      attach: [
        { kind: "template", ref: "book-first/opener" },
        { kind: "funnel", ref: "reply-funnel", label: "Reply funnel" },
      ],
    },
    { id: "qualify", label: "Fit?", kind: "condition", line: "growth", column: "sales" },
    {
      id: "book",
      label: "Book",
      kind: "time",
      line: "growth",
      column: "sales",
      action: "book",
      advance: [{ trigger: "trigger.booking", with: { on: "booked" } }],
      retries: 3,
    },
    { id: "wait", label: "Shows up?", kind: "race", line: "growth", column: "sales" },
    {
      id: "held",
      label: "Held",
      kind: "time",
      line: "growth",
      column: "sales",
      action: "held",
    },
    { id: "gone", label: "No show", kind: "exit", column: "sales", failure: true },
    { id: "fork", label: "Fork", kind: "split", line: "growth", column: "sales" },
    {
      id: "prep",
      label: "Prep",
      kind: "att",
      line: "growth",
      column: "sales",
      action: "other",
    },
    {
      id: "docs",
      label: "Docs",
      kind: "att",
      line: "growth",
      column: "sales",
      action: "form",
    },
    { id: "merge", label: "Ready", kind: "join", line: "growth", column: "sales", rule: "all" },
    { id: "test", label: "Test copy", kind: "ab", line: "growth", column: "sales" },
    {
      id: "pitch_a",
      label: "Pitch A",
      kind: "att",
      line: "growth",
      column: "sales",
      action: "email",
    },
    {
      id: "pitch_b",
      label: "Pitch B",
      kind: "att",
      line: "growth",
      column: "sales",
      action: "email",
    },
    {
      id: "review",
      label: "Approve proposal",
      kind: "approval",
      line: "growth",
      column: "sales",
    },
    {
      id: "proposal",
      label: "Proposal",
      kind: "att",
      line: "growth",
      column: "sales",
      action: "proposal",
    },
    {
      id: "signed",
      label: "Signed",
      kind: "att",
      line: "growth",
      column: "sales",
      deal: true,
      advance: [{ trigger: "trigger.document", with: { on: "signed" } }],
    },
    {
      id: "shared",
      label: "Follow-up",
      kind: "link",
      line: "growth",
      column: "delivery",
      flow: "shared_followup",
    },
    {
      id: "onboard",
      label: "Onboard",
      kind: "att",
      line: "growth",
      column: "delivery",
      action: "other",
    },
    {
      id: "pay",
      label: "Pay",
      kind: "cash",
      line: "growth",
      column: "money",
      terms: "standard",
      offer: "offer-a",
    },
    {
      id: "retain_start",
      label: "Retain start",
      kind: "att",
      line: "retain",
      column: "money",
      action: "other",
    },
    {
      id: "retain_pay",
      label: "Retainer",
      kind: "cash",
      line: "retain",
      column: "money",
      terms: "retainer",
      offer: "offer-b",
      planned: true,
    },
    { id: "done", label: "Done", kind: "exit", column: "money" },
  ],
  tracks: [
    { id: "social_to_hub", from: "social", to: "hub", line: "social", by: "system" },
    { id: "cold_to_hub", from: "cold", to: "hub", line: "cold", by: "system" },
    { id: "list_to_hub", from: "list", to: "hub", line: "list", by: "system" },
    { id: "team_to_hub", from: "team", to: "hub", line: "team", by: "system" },
    {
      id: "hub_to_reply",
      from: "hub",
      to: "reply",
      line: "growth",
      by: "system",
      entries: ["social", "cold", "list"],
    },
    { id: "hub_to_nurture", from: "hub", to: "nurture_start", line: "nurture", by: "system" },
    { id: "reply_to_qualify", from: "reply", to: "qualify", line: "growth", by: "system" },
    {
      id: "qualify_to_book",
      from: "qualify",
      to: "book",
      line: "growth",
      by: "system",
      cond: "fits",
    },
    {
      id: "qualify_to_fork",
      from: "qualify",
      to: "fork",
      line: "growth",
      by: "system",
      cond: "needs prep",
    },
    {
      id: "qualify_to_test",
      from: "qualify",
      to: "test",
      line: "growth",
      by: "system",
      else: true,
    },
    { id: "book_to_wait", from: "book", to: "wait", line: "growth", by: "system" },
    {
      id: "wait_to_held",
      from: "wait",
      to: "held",
      line: "growth",
      by: "system",
      cond: "attends",
    },
    {
      id: "wait_to_gone",
      from: "wait",
      to: "gone",
      kind: "exit",
      by: "system",
      wait: "2d",
    },
    { id: "held_to_review", from: "held", to: "review", line: "growth", by: "system" },
    { id: "fork_to_prep", from: "fork", to: "prep", line: "growth", by: "system" },
    { id: "fork_to_docs", from: "fork", to: "docs", line: "growth", by: "system" },
    { id: "prep_to_merge", from: "prep", to: "merge", line: "growth", by: "system" },
    { id: "docs_to_merge", from: "docs", to: "merge", line: "growth", by: "system" },
    { id: "merge_to_review", from: "merge", to: "review", line: "growth", by: "system" },
    {
      id: "test_to_a",
      from: "test",
      to: "pitch_a",
      line: "growth",
      by: "system",
      weight: 60,
    },
    {
      id: "test_to_b",
      from: "test",
      to: "pitch_b",
      line: "growth",
      by: "system",
      weight: 40,
    },
    { id: "pitch_a_to_review", from: "pitch_a", to: "review", line: "growth", by: "system" },
    { id: "pitch_b_to_review", from: "pitch_b", to: "review", line: "growth", by: "system" },
    { id: "review_to_proposal", from: "review", to: "proposal", line: "growth", by: "system" },
    {
      id: "proposal_to_signed",
      from: "proposal",
      to: "signed",
      line: "growth",
      by: "person",
      owner: "Sam",
      promise: "1d",
    },
    { id: "signed_to_shared", from: "signed", to: "shared", line: "growth", by: "system" },
    { id: "shared_to_onboard", from: "shared", to: "onboard", line: "growth", by: "system" },
    { id: "onboard_to_pay", from: "onboard", to: "pay", line: "growth", by: "system" },
    {
      id: "pay_to_retain",
      from: "pay",
      to: "retain_start",
      line: "retain",
      kind: "xfer",
      by: "person",
      owner: "Sam",
      label: "upsell",
    },
    {
      id: "nurture_to_pitch",
      from: "nurture_start",
      to: "pitch_a",
      line: "growth",
      kind: "xfer",
      by: "system",
      label: "cross-sell",
    },
    {
      id: "retain_start_to_pay",
      from: "retain_start",
      to: "retain_pay",
      line: "retain",
      by: "system",
    },
    {
      id: "renew",
      from: "retain_pay",
      to: "retain_start",
      kind: "back",
      by: "system",
      label: "after 90 days",
      planned: true,
    },
    { id: "pay_to_done", from: "pay", to: "done", kind: "exit", by: "system" },
  ],
  groups: [
    {
      id: "closing",
      label: "Closing",
      line: "growth",
      stations: ["proposal", "signed"],
      attach: [
        { kind: "doc", ref: "closing-checklist" },
        { kind: "note", ref: "8b0e6a52-3f1c-4d5e-9a77-1c2d3e4f5a6b", label: "Closing notes" },
      ],
    },
  ],
  frames: [
    {
      id: "stop",
      label: "Stop on reply",
      stations: ["pitch_a", "pitch_b"],
      trigger: { trigger: "trigger.reply" },
      exit: "gone",
    },
  ],
  flows: [
    {
      id: "shared_followup",
      label: "Follow-up flow",
      stations: [
        {
          id: "nudge",
          label: "Nudge",
          kind: "att",
          line: "growth",
          column: "delivery",
          action: "email",
          attach: [{ kind: "template", ref: "book-first/nudge" }],
        },
        {
          id: "check_in",
          label: "Check in",
          kind: "time",
          line: "growth",
          column: "delivery",
          action: "call",
        },
      ],
      tracks: [
        { id: "nudge_to_check_in", from: "nudge", to: "check_in", line: "growth", by: "system" },
      ],
    },
  ],
});

/**
 * Two metro bodies, `a` older and `b` newer, whose diff holds every kind of change: the shape
 * name; a line, station, track, group and frame each added, removed and changed; a line, station
 * and group each renamed; a line and a station renamed and changed at once. Nothing in `b` is
 * checked: a diff and an undo need no valid body.
 */
export const metroPair = (): { a: MetroBody; b: MetroBody } => {
  const a = metroShape();
  a.lines.push({ id: "spare", label: "Spare", tier: "front" });
  a.groups.push(
    { id: "prepwork", label: "Prep work", line: "growth", stations: ["prep"] },
    { id: "onboarding", label: "Onboarding", line: "growth", stations: ["onboard"] },
  );
  a.frames.push({
    id: "keep",
    stations: ["pitch_a"],
    trigger: { trigger: "trigger.reply" },
    exit: "done",
  });
  const b = structuredClone(a);
  b.name = "Newer name";
  // Lines: added, removed, renamed, changed, renamed and changed.
  b.lines = b.lines.filter((l) => l.id !== "spare");
  b.lines.push({ id: "extra", label: "Extra", tier: "core", offer: "offer-c", colour: 3 });
  const line = (id: string) => b.lines.find((l) => l.id === id) as MetroBody["lines"][number];
  line("nurture").label = "Warm";
  line("growth").colour = 5;
  line("social").label = "Socials";
  line("social").entry = { via: "organic", channel: "tiktok" };
  // Stations: added (with a track), removed (with its tracks), renamed, changed, both.
  b.stations = b.stations.filter((s) => s.id !== "docs");
  b.stations.push({
    id: "fresh",
    label: "Fresh",
    kind: "att",
    line: "growth",
    column: "sales",
    action: "other",
  });
  const station = (id: string) =>
    b.stations.find((s) => s.id === id) as MetroBody["stations"][number];
  station("book").label = "Booking";
  station("prep").idleDays = 3;
  station("reply").label = "Reply to us";
  station("reply").research = "full";
  // Tracks: added x2, removed x3 (two with the removed station), changed.
  b.tracks = b.tracks.filter(
    (t) => !["fork_to_docs", "docs_to_merge", "pay_to_done"].includes(t.id),
  );
  b.tracks.push(
    { id: "fresh_to_review", from: "fresh", to: "review", line: "growth", by: "system" },
    { id: "reply_to_book", from: "reply", to: "book", line: "growth", by: "system" },
  );
  const track = (id: string) => b.tracks.find((t) => t.id === id) as MetroBody["tracks"][number];
  track("book_to_wait").by = "person";
  track("book_to_wait").owner = "Sam";
  // Groups: added, removed, renamed, changed.
  b.groups = b.groups.filter((g) => g.id !== "closing");
  b.groups.push({ id: "wrap", label: "Wrap", line: "growth", stations: ["pay"] });
  const group = (id: string) => b.groups.find((g) => g.id === id) as MetroBody["groups"][number];
  group("prepwork").label = "Preparation";
  group("onboarding").stations = ["onboard", "shared"];
  // Frames: added, removed, changed.
  b.frames = b.frames.filter((f) => f.id !== "stop");
  b.frames.push({
    id: "halt",
    stations: ["prep"],
    trigger: { trigger: "trigger.reply" },
    exit: "done",
  });
  (b.frames.find((f) => f.id === "keep") as MetroBody["frames"][number]).stations = [
    "pitch_a",
    "pitch_b",
  ];
  return { a, b };
};

/** Launch films (designs/2026-10-25-ingestion-engine.md): find → read → extract → call. */
export const withFilms = (): MetroBody => {
  const b = asMetro(shape());
  b.lines.push({ id: "films", label: "Launch films", tier: "content", colour: 3 });
  const at = (id: string, kind: "read" | "extract" | "call", column: "marketing" | "sales") => ({
    id,
    label: id,
    kind,
    line: "films",
    column,
  });
  b.stations.push(
    {
      id: "find",
      label: "Find",
      kind: "find",
      line: "films",
      column: "marketing",
      sop: "launch-films",
    },
    at("read", "read", "marketing"),
    at("extract", "extract", "marketing"),
    at("call", "call", "sales"),
  );
  b.tracks.push(
    { id: "find_to_read", from: "find", to: "read", line: "films", by: "system" },
    { id: "read_to_extract", from: "read", to: "extract", line: "films", by: "system" },
    { id: "extract_to_call", from: "extract", to: "call", line: "films", by: "system" },
  );
  return b;
};

/** The films map plus a study line: find (the study's pages) → extract → call. */
export const withStudy = (slug = "placements"): MetroBody => {
  const b = withFilms();
  b.lines.push({ id: "study", label: "Study", tier: "content", colour: 4 });
  b.stations.push(
    { id: "sfind", label: "Find", kind: "find", line: "study", column: "marketing", study: slug },
    { id: "sextract", label: "Extract", kind: "extract", line: "study", column: "marketing" },
    { id: "scall", label: "Call", kind: "call", line: "study", column: "sales" },
  );
  b.tracks.push(
    { id: "sfind_to_sextract", from: "sfind", to: "sextract", line: "study", by: "system" },
    { id: "sextract_to_scall", from: "sextract", to: "scall", line: "study", by: "system" },
  );
  return b;
};

/** The metro body with a pain points line: a sourced out line that joins the hub's react track. */
export const withPain = (source = "import:12"): MetroBody => {
  const b = withStudy();
  b.lines.push({
    id: "pain",
    label: "Pain points",
    tier: "out",
    entry: { via: "sourced", source },
  });
  b.stations.push({
    id: "pain",
    label: "Pain points",
    kind: "att",
    line: "pain",
    column: "marketing",
  });
  b.tracks.push({ id: "pain_to_hub", from: "pain", to: "hub", line: "pain", by: "system" });
  const hubOut = b.tracks.find((t) => t.from === "hub" && t.entries);
  if (hubOut) hubOut.entries = [...(hubOut.entries ?? []), "pain"];
  return b;
};

/**
 * Synthetic shapes for the pipeline tests. One place, so no test builds its own copy.
 */
import type { MetroBody } from "../src/metro.js";
import type { ShapeBody, ShapeCheckContext, ShapeEdge, ShapeNode } from "../src/model.js";

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
 * A hand-made metro body with every station kind, track kind and logic kind. It passes
 * `checkMetro` with `ctx()`. The runtime cannot run it (`lowerable` says why).
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
    { id: "growth", label: "Growth", tier: "core", offer: "offer-a", colour: 0 },
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
  groups: [{ id: "closing", label: "Closing", line: "growth", stations: ["proposal", "signed"] }],
  frames: [
    {
      id: "stop",
      label: "Stop on reply",
      stations: ["pitch_a", "pitch_b"],
      trigger: { trigger: "trigger.reply" },
      exit: "gone",
    },
  ],
});

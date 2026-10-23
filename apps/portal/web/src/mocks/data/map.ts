/**
 * The Map's reads beyond the shared ones (`journeys.ts`, `offers.ts`): the answers of the D1
 * contract (`@wren/pipeline/history`). Each detail holds the runtime graph (`body`) and the stored
 * metro body (`metro`). A difference holds the change lines, both sides drawn (`views`) and the
 * marks. The mock makes them with the server's own pure code (`diffAnswerOf`), so a change line
 * reads as the real one does. No answer carries a body to save: a write names a version (`from`)
 * or a text. Synthetic data only.
 */
import type { Row } from "@wren/core/records/serve";
import type { DiffAnswer, ShapeRef, VersionLine } from "@wren/pipeline/history";
import type { MetroBody, MetroStation, MetroTrack } from "@wren/pipeline/metro";
import { depthOf, type ShapeBody } from "@wren/pipeline/model";
import { diffAnswerOf, drawnOf, runOf, type StoredBody } from "@wren/pipeline/stored";
import { type Answers, refuse } from "../api.js";
import {
  JOURNEY_ROWS,
  metroFor,
  SHAPE,
  SHAPE_GRAPH,
  SHAPE_METRO,
  SHAPE_VERSIONS,
} from "./journeys.js";
import { NUMBERS } from "./offers.js";
import { ago } from "./shell.js";

/** The first version, stored as a graph: Engaged led to a Joined step, which led to Booked. */
export const SHAPE_V1: ShapeBody = {
  name: "Sample shape",
  nodes: [
    ...SHAPE.nodes.filter((n) => n.id !== "signed"),
    { id: "joined", kind: "step", name: "Joined", action: "other", advance: [] },
    { id: "signed", kind: "offer", name: "Signed", offer: "starter", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "ads1_to_engaged", from: "ads1", to: "engaged", kind: "flow" },
    { id: "engaged_to_joined", from: "engaged", to: "joined", kind: "flow" },
    { id: "joined_to_booked", from: "joined", to: "booked", kind: "flow" },
    { id: "booked_to_signed", from: "booked", to: "signed", kind: "flow" },
  ],
};

/** The newest shape with a plan after the offer, and a loop back from Booked to Engaged. */
export const SHAPE_PLAN: MetroBody = metroFor({
  ...SHAPE_GRAPH,
  nodes: [
    ...SHAPE_GRAPH.nodes,
    { id: "standard", kind: "plan", name: "Standard plan", terms: "standard", advance: [] },
  ],
  edges: [
    ...SHAPE_GRAPH.edges,
    { id: "signed_to_standard", from: "signed", to: "standard", kind: "flow" },
    { id: "booked_to_engaged", from: "booked", to: "engaged", kind: "loop" },
  ],
});

/** The newest shape with a dead-end step after Engaged: a station that can go with its person moved. */
export const SHAPE_SPUR: MetroBody = metroFor({
  ...SHAPE_GRAPH,
  nodes: [
    ...SHAPE_GRAPH.nodes,
    { id: "follow", kind: "step", name: "Follow up", action: "other", advance: [] },
  ],
  edges: [
    ...SHAPE_GRAPH.edges,
    { id: "engaged_to_follow", from: "engaged", to: "follow", kind: "flow" },
  ],
});

/** A graph the map cannot draw: the metro model keeps the id `hub` for its own station. */
export const SHAPE_HUB_CLASH: ShapeBody = {
  ...SHAPE_GRAPH,
  nodes: SHAPE_GRAPH.nodes.map((n) => (n.id === "engaged" ? { ...n, id: "hub" } : n)),
  edges: SHAPE_GRAPH.edges.map((e) => ({
    ...e,
    id: e.id.replace("engaged", "hub"),
    from: e.from === "engaged" ? "hub" : e.from,
    to: e.to === "engaged" ? "hub" : e.to,
  })),
};

/**
 * A big shape, to pan: four outreach lines into the hub, two front ends and four offer lines, with
 * a condition, an exit, a transfer and a back track. Each line runs left to right in its columns,
 * so the drawing is wider and taller than a page and the Map scrolls inside its frame. Invented
 * names only.
 */
type StationKind = MetroStation["kind"];
const at = (
  id: string,
  label: string,
  line: string,
  column: MetroStation["column"],
  kind: StationKind = "att",
  over: Partial<MetroStation> = {},
): MetroStation => ({
  id,
  label,
  kind,
  line,
  column,
  ...(kind === "att" || kind === "time"
    ? { action: kind === "time" ? "book" : "other", ...over }
    : over),
});
/** The tracks along a line, in order: `a_to_b` for each neighbour pair. */
const run = (line: string, ids: string[], over: Partial<MetroTrack> = {}): MetroTrack[] =>
  ids.slice(1).map((to, i) => {
    const from = ids[i] as string;
    return { id: `${from}_to_${to}`, from, to, line, by: "system", ...over };
  });

export const SHAPE_BIG: MetroBody = {
  model: "metro",
  name: "Big sample shape",
  lines: [
    { id: "social", label: "Social", tier: "out", entry: { via: "organic", channel: "youtube" } },
    {
      id: "cold",
      label: "Cold",
      tier: "out",
      entry: { via: "outbound", channel: "email", campaign: "spring" },
    },
    { id: "list", label: "List", tier: "out", entry: { via: "sourced", source: "import:12" } },
    { id: "team", label: "Team", tier: "out", entry: { via: "group", segment: "7" } },
    { id: "nurture", label: "Nurture", tier: "front", colour: 2 },
    { id: "webinar", label: "Webinar", tier: "front", colour: 3 },
    { id: "growth", label: "Growth", tier: "core", offer: "starter", colour: 0 },
    { id: "audit", label: "Audit", tier: "core", offer: "audit", colour: 4 },
    { id: "referral", label: "Referral", tier: "core", offer: "referral", colour: 5 },
    { id: "retain", label: "Retain", tier: "core", offer: "retainer", colour: 1, planned: true },
  ],
  stations: [
    at("social", "Social", "social", "marketing"),
    at("cold", "Cold", "cold", "marketing"),
    at("list", "List", "list", "marketing"),
    at("team", "Team", "team", "marketing"),
    { id: "hub", label: "First touch", kind: "hub", column: "marketing" },
    at("nurture_start", "Nurture start", "nurture", "marketing"),
    at("nurture_wait", "Warm up", "nurture", "sales", "time"),
    at("nurture_reply", "Replied", "nurture", "sales"),
    at("nurture_book", "Booked", "nurture", "sales", "time"),
    at("web_signup", "Sign up", "webinar", "marketing"),
    at("web_remind", "Remind", "webinar", "sales"),
    at("web_attend", "Attend", "webinar", "sales", "time"),
    at("web_offer", "Offer", "webinar", "sales"),
    at("web_pay", "Webinar seat", "webinar", "money", "cash", { terms: "standard" }),
    at("reply", "Reply", "growth", "marketing", "att", { action: "reply" }),
    at("qualify", "Fit?", "growth", "sales", "condition"),
    at("book", "Book", "growth", "sales", "time"),
    at("held", "Held", "growth", "sales", "time", { action: "held" }),
    at("proposal", "Proposal", "growth", "sales", "att", { action: "proposal" }),
    at("signed", "Signed", "growth", "sales", "att", { deal: true }),
    at("onboard", "Onboard", "growth", "delivery"),
    at("kickoff", "Kick-off", "growth", "delivery", "time", { action: "call" }),
    at("pay", "Pay", "growth", "money", "cash", { terms: "standard" }),
    at("audit_ask", "Ask", "audit", "marketing", "att", { action: "form" }),
    at("audit_call", "Audit call", "audit", "sales", "time", { action: "call" }),
    at("audit_report", "Report", "audit", "delivery"),
    at("audit_pay", "Audit fee", "audit", "money", "cash", { terms: "standard" }),
    at("ref_ask", "Ask for names", "referral", "delivery"),
    at("ref_intro", "Intro", "referral", "delivery"),
    at("ref_thanks", "Thank you", "referral", "money"),
    at("retain_start", "Retain start", "retain", "delivery"),
    at("retain_check", "Check in", "retain", "delivery", "time", { action: "call" }),
    at("retain_pay", "Retainer", "retain", "money", "cash", { terms: "retainer", planned: true }),
    { id: "gone", label: "Not a fit", kind: "exit", column: "sales", failure: true },
    { id: "done", label: "Done", kind: "exit", column: "money" },
  ],
  tracks: [
    ...["social", "cold", "list", "team"].map(
      (l): MetroTrack => ({ id: `${l}_to_hub`, from: l, to: "hub", line: l, by: "system" }),
    ),
    ...run("nurture", ["hub", "nurture_start", "nurture_wait", "nurture_reply", "nurture_book"]),
    ...run("webinar", ["hub", "web_signup", "web_remind", "web_attend", "web_offer", "web_pay"]),
    {
      id: "hub_to_reply",
      from: "hub",
      to: "reply",
      line: "growth",
      by: "system",
      entries: ["social", "cold", "list"],
    },
    { id: "reply_to_qualify", from: "reply", to: "qualify", line: "growth", by: "system" },
    {
      id: "qualify_to_book",
      from: "qualify",
      to: "book",
      line: "growth",
      by: "system",
      cond: "fits",
    },
    { id: "qualify_to_gone", from: "qualify", to: "gone", kind: "exit", by: "system" },
    ...run("growth", ["book", "held", "proposal"]),
    {
      id: "proposal_to_signed",
      from: "proposal",
      to: "signed",
      line: "growth",
      by: "person",
      owner: "Sam Reed",
      promise: "1d",
    },
    ...run("growth", ["signed", "onboard", "kickoff", "pay"]),
    { id: "hub_to_audit_ask", from: "hub", to: "audit_ask", line: "audit", by: "system" },
    ...run("audit", ["audit_ask", "audit_call", "audit_report", "audit_pay"]),
    { id: "hub_to_ref_ask", from: "hub", to: "ref_ask", line: "referral", by: "system" },
    ...run("referral", ["ref_ask", "ref_intro", "ref_thanks"]),
    {
      id: "kickoff_to_retain_start",
      from: "kickoff",
      to: "retain_start",
      line: "retain",
      kind: "xfer",
      by: "system",
      label: "upsell",
    },
    ...run("retain", ["retain_start", "retain_check", "retain_pay"]),
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
  groups: [],
  frames: [],
};

/**
 * The big shape with a group on Growth's talk and things attached: a link on the line, an SOP on
 * Book. The focus page's stories read it (designs/2026-10-23-focus-view.md, F1).
 */
export const SHAPE_FOCUS: MetroBody = {
  ...SHAPE_BIG,
  lines: SHAPE_BIG.lines.map((l) =>
    l.id === "growth"
      ? { ...l, attach: [{ kind: "link", ref: "https://example.test/growth-deck", label: "Deck" }] }
      : l,
  ),
  stations: SHAPE_BIG.stations.map((s) =>
    s.id === "book" ? { ...s, attach: [{ kind: "sop", ref: "booking", label: "Booking SOP" }] } : s,
  ),
  groups: [
    { id: "talk", label: "Sales talk", line: "growth", stations: ["book", "held", "proposal"] },
  ],
};

/** `focusAnswers`: the focus shape on the page. */
export const focusAnswers = (fallback: { get: Pipeline; list: Pipeline }): Answers =>
  shapeAnswers(fallback, SHAPE_FOCUS);

/** A saved view of the Map: Growth and Sales talk, his own. */
export const MAP_VIEW = {
  id: 41,
  name: "Sales desk",
  params: "parts=line%3Agrowth%2Cgroup%3Atalk",
  shared: false,
  mine: true,
};

/**
 * `viewsAnswers`: his saved views of the Map and his prefs, kept for the story. Each save and pref
 * write lands in MAP_CALLS (designs/2026-10-23-focus-view.md, F2).
 */
export function viewsAnswers(
  views: (typeof MAP_VIEW)[] = [MAP_VIEW],
  prefs: Record<string, unknown> = {},
): Answers {
  let kept = [...views];
  const mine = { ...prefs };
  return {
    "console/savedViews": (b) => (b.record === "map" ? kept : []),
    "console/saveView": (b) => {
      MAP_CALLS.push({ path: "saveView", body: b });
      const v = {
        id: Number(b.id ?? 50 + kept.length),
        name: String(b.name ?? kept.find((x) => x.id === b.id)?.name ?? ""),
        params: String(b.params ?? ""),
        shared: !!b.shared,
        mine: true,
      };
      kept = [...kept.filter((x) => x.id !== v.id), v];
      return v;
    },
    "console/prefs": () => mine,
    "console/setPref": (b) => {
      MAP_CALLS.push({ path: "setPref", body: b });
      mine[String(b.key)] = b.value;
      return { ok: true };
    },
  };
}

/** `bigAnswers`: the big shape on the page. */
export const bigAnswers = (fallback: { get: Pipeline; list: Pipeline }): Answers =>
  shapeAnswers(fallback, SHAPE_BIG);

/** An open journey on the spur's Follow up station: one person who must move before it can go. */
export const SPUR_PERSON: Row = {
  ...(JOURNEY_ROWS["pipeline.journey"]?.[0] as Row),
  id: "j8",
  name: "Fay Lin",
  profile: 8,
  node: "follow",
  nodeName: "Follow up",
  email: "fay@example.test",
  daysAtNode: 1,
};

/** The numbers of the plan station and the plan's tracks, per window. */
const PLAN_NUMBERS: Row[] = [
  ...NUMBERS.filter((r) => String(r.id).startsWith("station:signed")).map((r) => ({
    ...r,
    id: String(r.id).replace("signed", "standard"),
    node: "standard",
    label: "Standard plan",
    now: 3,
    scheduled: { amount: 3_000, currency: "CAD" },
    collected: { amount: 1_800, currency: "CAD" },
    deals: 3,
  })),
  ...NUMBERS.filter((r) => String(r.id).startsWith("track:booked_to_signed")).flatMap((r) => [
    {
      ...r,
      id: String(r.id).replace("booked_to_signed", "signed_to_standard"),
      node: "signed_to_standard",
      crossings: 3,
      from: "signed",
      to: "standard",
    },
    {
      ...r,
      id: String(r.id).replace("booked_to_signed", "booked_to_engaged"),
      node: "booked_to_engaged",
      crossings: 2,
      from: "booked",
      to: "engaged",
    },
  ]),
];

type Ask = Record<string, unknown>;
type Pipeline = (b: Ask) => unknown;

/** A `pipeline.shape` row's detail for a stored body: the graph the runtime runs, and the drawing. */
export function shapeDetail(stored: StoredBody, versions: readonly VersionLine[] = SHAPE_VERSIONS) {
  const body = runOf(stored);
  const drawn = drawnOf(stored);
  return {
    body,
    metro: drawn.ok ? drawn.metro : null,
    drawErrors: drawn.ok ? [] : drawn.errors,
    depths: depthOf(body),
    versions,
  };
}

const shapeRow = (stored: StoredBody, versions: readonly VersionLine[]) => ({
  record: "pipeline.shape",
  row: { id: "shape" },
  related: [],
  activity: [],
  detail: shapeDetail(stored, versions),
});

/**
 * Answers for a story that wants a bigger shape or one of its own. They stand in front of the
 * shared `recordsGet` and `recordsList`, which `fallback` answers for every other record.
 */
export function shapeAnswers(
  fallback: { get: Pipeline; list: Pipeline },
  stored: StoredBody,
  extra: readonly Row[] = [],
): Answers {
  return {
    "pipeline/recordsGet": (b) =>
      b.record === "pipeline.shape" ? shapeRow(stored, SHAPE_VERSIONS) : fallback.get(b),
    "pipeline/recordsList": (b) => {
      const got = fallback.list(b) as { rows: Row[]; total: number };
      if (b.record !== "pipeline.number") return got;
      const where = (b.where ?? {}) as Record<string, unknown>;
      const more = extra.filter(
        (r) => r.kind === where.kind && (where.window === undefined || r.window === where.window),
      );
      return { ...got, rows: [...got.rows, ...more], total: got.total + more.length };
    },
  };
}

/** `planAnswers`: the newest shape with a plan and a loop. */
export const planAnswers = (fallback: { get: Pipeline; list: Pipeline }): Answers =>
  shapeAnswers(fallback, SHAPE_PLAN, PLAN_NUMBERS);

/** What the Map's writes sent since the last `forgetMapCalls()`, in order. */
export const MAP_CALLS: { path: string; body: Record<string, unknown> }[] = [];
export const forgetMapCalls = () => MAP_CALLS.splice(0);

/** A file a person might import: the newest shape with one more station after Engaged. */
export const FILE_METRO: MetroBody = {
  ...SHAPE_METRO,
  stations: [
    ...SHAPE_METRO.stations,
    {
      id: "replied",
      label: "Replied",
      kind: "att",
      line: "signed",
      column: "sales",
      action: "reply",
    },
  ],
  tracks: [
    ...SHAPE_METRO.tracks,
    { id: "engaged_to_replied", from: "engaged", to: "replied", line: "signed", by: "system" },
  ],
};
/** The file's text; the preview reads a file with no `nodes:` line as not a shape. */
export const FILE_TEXT = "name: Sample shape\nnodes:\n  - id: mail\n";

/** The difference from `a` to `b` as the server answers it: `bodyAt` gives each side's stored body. */
export function diffBetween(
  a: ShapeRef,
  b: ShapeRef,
  bodyAt: (ref: ShapeRef) => StoredBody,
): DiffAnswer {
  return { a, b, ...diffAnswerOf(bodyAt(a), bodyAt(b), true) };
}

/** Versions 1 and 2 of the default shape. Anything newer reads as the newest. */
const bodyOf = (ref: ShapeRef): StoredBody => (Number(ref) === 1 ? SHAPE_V1 : SHAPE_METRO);

const refOf = (v: unknown): ShapeRef => {
  const s = String(v);
  return s.startsWith("draft:") ? (s as ShapeRef) : Number(s);
};

const version = (stored: StoredBody, number: number, note: string): VersionLine => {
  const run = runOf(stored);
  return {
    number,
    parent: number > 1 ? number - 1 : null,
    note,
    at: ago(0),
    by: "Ada North",
    nodes: run.nodes.length,
    edges: run.edges.length,
    draft: null,
    tags: [],
    mirror: null,
  };
};

/**
 * The Map's writes, answering as the server does when one lands. A write names a version (`from`)
 * or a text, never a body. The file preview reads `FILE_TEXT` as a shape and anything without a
 * `nodes:` line as not one.
 */
export const MAP_WRITES: Answers = {
  "pipeline/shapeVersion": (b) => {
    MAP_CALLS.push({ path: "shapeVersion", body: b });
    return { version: 3 };
  },
  "pipeline/shapeImport": (b) => {
    MAP_CALLS.push({ path: "shapeImport", body: b });
    return { version: 3, changed: true, terms: [] };
  },
  "pipeline/shapeStart": (b) => {
    MAP_CALLS.push({ path: "shapeStart", body: b });
    return { version: 1 };
  },
  "pipeline/shapeExport": (b) => {
    MAP_CALLS.push({ path: "shapeExport", body: b });
    return { text: `name: Sample shape\nref: ${String(b.ref ?? "newest")}\n` };
  },
  "pipeline/shapePreview": (b) => {
    const text = String(b.text ?? "");
    if (!text.includes("nodes:")) return refuse(400, "The file is not a shape file.");
    return {
      a: 2,
      ...diffAnswerOf(SHAPE_METRO, FILE_METRO, true),
      note: null,
      moves: null,
    };
  },
};

/** The History's difference of two versions: version 1 and 2 only. */
export const MAP_ANSWERS: Answers = {
  ...MAP_WRITES,
  "pipeline/shapeDiff": (b) => diffBetween(refOf(b.a), refOf(b.b), bodyOf),
};

/**
 * A shape that changes as the story saves it: `shapeVersion` (with `from`), `shapeImport` and
 * `shapeStart` write the newest version, and the next read gives it back. `from` is the shape it
 * starts with (null: none yet). They stand in front of the shared `recordsGet`, which `fallback`
 * answers for the rest.
 */
export function liveShape(
  fallback: { get: Pipeline; list?: Pipeline },
  from: StoredBody | null = SHAPE_METRO,
  /** Open journeys beyond the shared ones (rows of `pipeline.journey`). */
  more: readonly Row[] = [],
): Answers {
  const bodies = new Map<number, StoredBody>(
    from
      ? [
          [1, SHAPE_V1],
          [2, from],
        ]
      : [],
  );
  let versions: VersionLine[] = from ? [...SHAPE_VERSIONS] : [];
  const newest = () => bodies.get(versions[0]?.number ?? 0) ?? null;
  const save = (path: string, next: StoredBody, note: string, b: Ask) => {
    MAP_CALLS.push({ path, body: b });
    const n = (versions[0]?.number ?? 0) + 1;
    bodies.set(n, next);
    versions = [version(next, n, note), ...versions];
    return { version: n };
  };
  const at = (ref: ShapeRef): StoredBody => bodies.get(Number(ref)) ?? newest() ?? SHAPE_METRO;
  return {
    ...MAP_WRITES,
    "pipeline/recordsList": (b) => {
      const got = (fallback.list?.(b) ?? { rows: [], total: 0 }) as { rows: Row[]; total: number };
      const where = (b.where ?? {}) as Record<string, unknown>;
      if (b.record !== "pipeline.journey" || where.status !== "open" || !more.length) return got;
      return { ...got, rows: [...got.rows, ...more], total: got.total + more.length };
    },
    "pipeline/recordsGet": (b) => {
      if (b.record !== "pipeline.shape") return fallback.get(b);
      const body = newest();
      return body
        ? shapeRow(body, versions)
        : { record: "pipeline.shape", row: null, detail: null };
    },
    "pipeline/shapeVersion": (b) => {
      const n = typeof b.from === "number" ? b.from : null;
      if (n === null) return refuse(400, "Name the version to save from.");
      return save("shapeVersion", at(n), String(b.note), b);
    },
    "pipeline/shapeImport": (b) =>
      Object.assign(save("shapeImport", FILE_METRO, String(b.note), b), {
        changed: true,
        terms: [],
      }),
    "pipeline/shapeStart": (b) => save("shapeStart", SHAPE_METRO, "Starter", b),
    "pipeline/shapeDiff": (b) => diffBetween(refOf(b.a), refOf(b.b), at),
  };
}

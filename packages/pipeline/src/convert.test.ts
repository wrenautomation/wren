import { describe, expect, it } from "vitest";
import { ctx, flow, grown, metroShape, shape, wideShape } from "../test/fixtures.js";
import { graphOf, lowerable, metroOf } from "./convert.js";
import { canonicalJson } from "./diff.js";
import { checkMetro, HUB, type MetroBody, placesOf } from "./metro.js";
import { depthOf, holds, type ShapeBody, type ShapeNode } from "./model.js";
import { starterShape } from "./starter.js";
import { shapeWorkflow } from "./workflow.js";

const byId = <T extends { id: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const sorted = (g: ShapeBody): ShapeBody => ({
  ...g,
  nodes: byId(g.nodes),
  edges: byId(g.edges),
});

/** `metroOf` that must be ok. */
const made = (g: ShapeBody) => {
  const r = metroOf(g);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r;
};

const step = (id: string, action: "comment" | "other" = "other"): ShapeNode => ({
  id,
  kind: "step",
  name: id,
  action,
  advance: [],
});
const offer = (id: string): ShapeNode => ({
  id,
  kind: "offer",
  name: id,
  offer: "offer-a",
  advance: [],
});

/** A second offer, reached from the first through a step, with a step before the first offer. */
const twoOffers = (): ShapeBody =>
  grown(
    [step("upsell_step"), offer("signed_b"), step("side")],
    [flow("signed", "upsell_step"), flow("upsell_step", "signed_b"), flow("yt", "side")],
  );

const CASES: Array<[string, () => ShapeBody]> = [
  ["the starter", () => starterShape().body],
  ["shape()", () => shape()],
  ["wideShape()", () => wideShape()],
  [
    "shape() with a loop and a late step",
    () =>
      grown(
        [step("late", "comment")],
        [
          flow("proposal", "late"),
          flow("late", "signed"),
          flow("late", "engaged", { kind: "loop" }),
        ],
      ),
  ],
  ["two offers and a step on no offer", twoOffers],
];

describe("metroOf and graphOf: the round trip", () => {
  describe.each(CASES)("%s", (_name, make) => {
    it("converts, passes checkMetro and is lowerable", () => {
      const r = made(make());
      expect(checkMetro(r.body, ctx())).toEqual([]);
      expect(lowerable(r.body)).toEqual([]);
    });

    it("gives the same graph back, nodes and edges by id", () => {
      const g = make();
      const r = made(g);
      expect(r.notes).toEqual([]);
      expect(canonicalJson(sorted(graphOf(r.body)))).toBe(canonicalJson(sorted(g)));
    });

    it("keeps ids: a station per holding node, a track per other edge, a line per source", () => {
      const g = make();
      const { body } = made(g);
      const stations = new Set(body.stations.map((s) => s.id));
      for (const n of g.nodes.filter(holds)) expect(stations.has(n.id)).toBe(true);
      const tracks = new Set(body.tracks.map((t) => t.id));
      const sources = new Set(g.nodes.filter((n) => n.kind === "source").map((n) => n.id));
      for (const e of g.edges) if (!sources.has(e.from)) expect(tracks.has(e.id)).toBe(true);
      const outs = body.lines.filter((l) => l.tier === "out").map((l) => l.id);
      expect(outs).toEqual([...sources]);
      const offers = g.nodes.filter((n) => n.kind === "offer").map((n) => n.id);
      expect(body.lines.filter((l) => l.tier === "core").map((l) => l.id)).toEqual(offers);
    });

    it("runs as the same workflow", () => {
      const g = make();
      const { body } = made(g);
      expect(shapeWorkflow(1, sorted(graphOf(body)), "wren")).toEqual(
        shapeWorkflow(1, sorted(g), "wren"),
      );
    });

    it("never changes its input, and the output shares nothing with it", () => {
      const g = make();
      const before = canonicalJson(g);
      const r = made(g);
      expect(canonicalJson(g)).toBe(before);
      const metroBefore = canonicalJson(r.body);
      const back = graphOf(r.body);
      expect(canonicalJson(r.body)).toBe(metroBefore);
      for (const n of back.nodes) if (n.kind !== "source") n.advance.push({ trigger: "x" });
      expect(canonicalJson(r.body)).toBe(metroBefore);
    });

    it("is the same every time", () => {
      const g = make();
      expect(canonicalJson(made(g))).toBe(canonicalJson(made(g)));
      const m = made(g).body;
      expect(JSON.stringify(graphOf(m))).toBe(JSON.stringify(graphOf(m)));
    });
  });

  it("pins the order of graphOf: sources in line order, then stations; edges in track order", () => {
    // Restate replays `shape.v<n>` from this order. A change here is a break for stored bodies.
    const back = graphOf(made(shape()).body);
    expect(back.nodes.map((n) => n.id)).toEqual([
      "yt",
      "mail",
      "engaged",
      "booked",
      "proposal",
      "signed",
      "standard",
    ]);
    expect(back.edges.map((e) => e.id)).toEqual([
      "yt_to_engaged",
      "mail_to_engaged",
      "engaged_to_booked",
      "booked_to_proposal",
      "proposal_to_signed",
      "signed_to_standard",
    ]);
  });
});

describe("metroOf: the model it draws", () => {
  it("makes an out line with a start station and a track to the hub for each source", () => {
    const { body } = made(shape());
    expect(body.lines.slice(0, 2)).toEqual([
      { id: "yt", label: "YouTube", tier: "out", entry: { via: "organic", channel: "youtube" } },
      { id: "mail", label: "Email", tier: "out", entry: { via: "outbound", channel: "email" } },
    ]);
    expect(body.stations.slice(0, 3)).toEqual([
      { id: "yt", label: "YouTube", kind: "att", line: "yt", column: "marketing" },
      { id: "mail", label: "Email", kind: "att", line: "mail", column: "marketing" },
      { id: HUB, label: "First touch", kind: "hub", column: "marketing" },
    ]);
    expect(body.tracks.slice(0, 2)).toEqual([
      { id: "yt_to_hub", from: "yt", to: HUB, line: "yt", by: "system" },
      { id: "mail_to_hub", from: "mail", to: HUB, line: "mail", by: "system" },
    ]);
  });

  it("carries every source field into the entry, and group becomes segment", () => {
    const g = shape();
    g.nodes.push(
      { id: "seg", kind: "source", name: "Seg", via: "group", group: "7", parked: true },
      { id: "list", kind: "source", name: "List", via: "sourced", source: "import:12" },
      { id: "ad", kind: "source", name: "Ad", via: "ads", campaign: "spring", channel: "meta" },
    );
    g.edges.push(flow("seg", "engaged"), flow("list", "engaged"), flow("ad", "engaged"));
    const { body } = made(g);
    const entry = (id: string) => body.lines.find((l) => l.id === id)?.entry;
    expect(entry("seg")).toEqual({ via: "group", segment: "7", parked: true });
    expect(entry("list")).toEqual({ via: "sourced", source: "import:12" });
    expect(entry("ad")).toEqual({ via: "ads", campaign: "spring", channel: "meta" });
    expect(checkMetro(body, ctx())).toEqual([]);
    expect(graphOf(body).nodes.find((n) => n.id === "seg")).toEqual(
      g.nodes.find((n) => n.id === "seg"),
    );
  });

  it("makes one hub track per target, with the sources that reach it as entries", () => {
    const { body } = made(wideShape());
    const hub = body.tracks.filter((t) => t.from === HUB);
    expect(hub.map((t) => t.id)).toEqual([
      "hub_to_comment",
      "hub_to_dm",
      "hub_to_visit",
      "hub_to_offer",
    ]);
    expect(hub.map((t) => t.entries)).toEqual([
      ["yt", "ig", "x", "tiktok", "linkedin", "facebook", "reddit", "threads"],
      ["dm_in"],
      ["ads"],
      ["partner"],
    ]);
    for (const t of hub) {
      expect(t.by).toBe("system");
      expect(t.line).toBe(body.stations.find((s) => s.id === t.to)?.line);
    }
  });

  it("makes a core offer line and a deal station for each offer node, colours in turn", () => {
    const g = shape();
    const ids = Array.from({ length: 9 }, (_, i) => `o${i}`);
    g.nodes.push(...ids.map(offer));
    g.edges.push(...ids.map((id) => flow("booked", id)));
    const { body } = made(g);
    const lines = body.lines.filter((l) => l.tier === "core");
    expect(lines.map((l) => l.colour)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    expect(lines[0]).toEqual({
      id: "signed",
      label: "Signed",
      tier: "core",
      offer: "offer-a",
      colour: 0,
    });
    const deal = body.stations.find((s) => s.id === "signed");
    expect(deal).toMatchObject({ kind: "att", deal: true, line: "signed", column: "sales" });
    expect(deal?.action).toBeUndefined();
  });

  it("makes a cash station for a plan, on its offer's line, with the offer and the terms", () => {
    const { body } = made(shape());
    expect(body.stations.find((s) => s.id === "standard")).toEqual({
      id: "standard",
      label: "Standard",
      kind: "cash",
      line: "signed",
      column: "money",
      terms: "standard",
      offer: "offer-a",
      advance: [],
    });
  });

  it("takes the kind of a step from its action", () => {
    const { body } = made(wideShape());
    const kind = (id: string) => body.stations.find((s) => s.id === id)?.kind;
    expect(kind("comment")).toBe("att");
    expect(kind("cta")).toBe("att");
    expect(kind("proposal")).toBe("att");
    expect(kind("book")).toBe("time");
    expect(kind("held")).toBe("time");
  });

  it("keeps advance, research and idleDays on the station", () => {
    const g = shape();
    g.nodes = g.nodes.map((n) =>
      n.id === "engaged" && n.kind === "step" ? { ...n, research: "full", idleDays: 5 } : n,
    );
    const { body } = made(g);
    expect(body.stations.find((s) => s.id === "engaged")).toMatchObject({
      research: "full",
      idleDays: 5,
      advance: [{ trigger: "trigger.reply" }],
    });
  });

  it("puts a step on the line of the nearest deal station after it", () => {
    const { body } = made(twoOffers());
    const line = (id: string) => body.stations.find((s) => s.id === id)?.line;
    expect(line("engaged")).toBe("signed");
    expect(line("upsell_step")).toBe("signed_b");
    expect(line("signed_b")).toBe("signed_b");
  });

  it("breaks a tie between two deal stations by line order", () => {
    const g = shape();
    g.nodes.push(offer("signed_b"));
    g.edges.push(flow("booked", "signed_b"));
    const { body } = made(g);
    // booked reaches signed_b in one hop and signed in two: the nearer one wins.
    expect(body.stations.find((s) => s.id === "booked")?.line).toBe("signed_b");
    g.edges.push(flow("booked", "signed"));
    expect(made(g).body.stations.find((s) => s.id === "booked")?.line).toBe("signed");
  });

  it("falls back to the nearest deal station before a step, then to an unrouted front line", () => {
    const g = grown(
      [step("after"), step("island")],
      [flow("standard", "after"), flow("yt", "island")],
    );
    const { body } = made(g);
    expect(body.stations.find((s) => s.id === "after")?.line).toBe("signed");
    expect(body.stations.find((s) => s.id === "island")?.line).toBe("unrouted");
    expect(body.lines.find((l) => l.id === "unrouted")).toEqual({
      id: "unrouted",
      label: "Not on an offer",
      tier: "front",
    });
    expect(checkMetro(body, ctx())).toEqual([]);
  });

  it("takes a free id for the unrouted line when the id is taken", () => {
    const g = grown(
      [{ id: "unrouted", kind: "source", name: "U", via: "organic" }, step("island")],
      [flow("unrouted", "island")],
    );
    const { body } = made(g);
    expect(body.lines.map((l) => l.id)).toContain("unrouted_2");
    expect(body.stations.find((s) => s.id === "island")?.line).toBe("unrouted_2");
    expect(
      graphOf(body)
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(g.nodes.map((n) => n.id).sort());
  });

  it("puts marketing actions in marketing, other steps in sales, steps after a deal in delivery", () => {
    const g = grown([step("onboard")], [flow("signed", "onboard")]);
    const { body } = made(g);
    const column = (id: string) => body.stations.find((s) => s.id === id)?.column;
    expect(column("engaged")).toBe("marketing");
    expect(column("booked")).toBe("sales");
    expect(column("proposal")).toBe("sales");
    expect(column("signed")).toBe("sales");
    expect(column("onboard")).toBe("delivery");
    expect(column("standard")).toBe("money");
  });

  it("lifts a column so no flow edge goes left", () => {
    // A comment step after the proposal would be marketing; the edge into it forces it to sales.
    const g = grown([step("late", "comment")], [flow("proposal", "late"), flow("late", "signed")]);
    const { body } = made(g);
    expect(body.stations.find((s) => s.id === "late")?.column).toBe("sales");
    expect(checkMetro(body, ctx())).toEqual([]);
  });

  it("draws a flow edge as a plain track on the end station's line, an xfer across lines", () => {
    const { body } = made(twoOffers());
    const track = (id: string) => body.tracks.find((t) => t.id === id);
    expect(track("engaged_to_booked")).toMatchObject({ line: "signed", by: "system" });
    expect(track("engaged_to_booked")?.kind).toBeUndefined();
    expect(track("signed_to_upsell_step")).toMatchObject({ kind: "xfer", line: "signed_b" });
    expect(track("upsell_step_to_signed_b")?.kind).toBeUndefined();
  });

  it("sets by to system when the to-station has an advance trigger, else person", () => {
    // A node's advance moves a journey into it, so the end of the track decides who moves it.
    const { body } = made(shape());
    const by = (id: string) => body.tracks.find((t) => t.id === id)?.by;
    expect(by("engaged_to_booked")).toBe("system");
    expect(by("booked_to_proposal")).toBe("person");
    expect(by("proposal_to_signed")).toBe("system");
    expect(by("signed_to_standard")).toBe("person");
  });

  it("draws a loop edge as a back track with its label and no line", () => {
    const { body } = made(wideShape());
    const back = body.tracks.filter((t) => t.kind === "back");
    expect(back.map((t) => t.id)).toEqual([
      "cta_to_dm",
      "visit_to_dm",
      "book_to_dm",
      "held_to_dm",
      "proposal_to_dm",
    ]);
    for (const t of back) {
      expect(t).toMatchObject({ to: "dm", label: "no answer", by: expect.any(String) });
      expect(t.line).toBeUndefined();
    }
  });
});

describe("metroOf: what it refuses and what it cannot keep", () => {
  it("refuses a node with the id hub", () => {
    const g = grown([step("hub")], [flow("engaged", "hub")]);
    const r = metroOf(g);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain('Node "hub" cannot become a station');
  });

  it("refuses a plan that follows no offer, and an edge to a node that is not there", () => {
    const g = shape();
    g.edges = g.edges.filter((e) => e.id !== "signed_to_standard");
    g.edges.push(flow("booked", "standard"), flow("booked", "ghost"));
    const r = metroOf(g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        'Edge "booked_to_ghost" names node "ghost", which is not in the shape.',
        'Plan "standard" follows no offer node.',
      ]);
    }
  });

  it("refuses an edge that ends at a source", () => {
    const g = shape();
    g.edges.push(flow("engaged", "yt"));
    const r = metroOf(g);
    expect(r.ok).toBe(false);
  });

  it("notes the label and the id of a source edge, which the model cannot keep", () => {
    const g = shape();
    g.edges = g.edges.map((e) =>
      e.id === "yt_to_engaged"
        ? { ...e, label: "video" }
        : e.id === "mail_to_engaged"
          ? { ...e, id: "mail_in" }
          : e,
    );
    const r = made(g);
    expect(r.notes).toEqual([
      'Source edge "yt_to_engaged" has the label "video". The metro model keeps no label there. It is dropped.',
      'Source edge "mail_in" becomes "mail_to_engaged". The metro model keeps no id for it.',
    ]);
    // The body still converts; graphOf gives the default id and no label.
    const back = graphOf(r.body);
    expect(back.edges.find((e) => e.id === "yt_to_engaged")?.label).toBeUndefined();
    expect(back.edges.map((e) => e.id)).not.toContain("mail_in");
  });

  it("leaves out a loop edge that starts at a source, and says so", () => {
    const g = shape();
    g.edges.push(flow("yt", "engaged", { kind: "loop", id: "yt_loop" }));
    const r = made(g);
    expect(r.notes).toEqual([
      'Loop edge "yt_loop" starts at source "yt". A source holds nobody, so the edge does nothing. It is left out.',
    ]);
    expect(r.body.tracks.map((t) => t.id)).not.toContain("yt_loop");
    expect(checkMetro(r.body, ctx())).toEqual([]);
  });

  it("is ok for a graph with a source and nothing else", () => {
    const g: ShapeBody = {
      name: "Empty",
      nodes: [{ id: "yt", kind: "source", name: "YouTube", via: "organic" }],
      edges: [],
    };
    const r = made(g);
    expect(r.body.stations.map((s) => s.id)).toEqual(["yt", HUB]);
    expect(checkMetro(r.body, ctx())).toEqual([]);
    expect(canonicalJson(graphOf(r.body))).toBe(canonicalJson(g));
  });
});

describe("lowerable", () => {
  const base = (): MetroBody => made(shape()).body;
  const why = (b: MetroBody): string[] => lowerable(b);

  it("is empty for a body made by metroOf", () => {
    expect(why(base())).toEqual([]);
  });

  it("refuses logic stations, exit stations, exit tracks and frames", () => {
    const m = metroShape();
    const lines = why(m);
    for (const kind of ["condition", "race", "split", "join", "ab", "approval", "link"]) {
      expect(lines.some((l) => l.includes(`is a ${kind} station`))).toBe(true);
    }
    expect(lines).toContain('Station "gone" is an exit. The runtime does not run exits yet.');
    expect(lines).toContain(
      'Track "wait_to_gone" is an exit track. The runtime does not run exit tracks yet.',
    );
    expect(lines).toContain(
      'Frame "stop" is an interrupt frame. The runtime does not run frames yet.',
    );
  });

  it("refuses an out line with other than its own station", () => {
    const b = base();
    b.stations.push({ id: "extra", label: "Extra", kind: "att", line: "yt", column: "marketing" });
    expect(why(b)).toEqual([
      'Out line "yt" must hold one station, its own ("yt"), not "yt", "extra".',
    ]);
    const c = base();
    c.stations = c.stations.filter((s) => s.id !== "yt");
    expect(why(c)).toEqual(['Out line "yt" must hold one station, its own ("yt"), not none.']);
  });

  it("refuses a cash station without terms, a deal on a line without an offer, a step without action", () => {
    const b = base();
    b.stations = b.stations.map((s) => {
      if (s.id === "standard") {
        const { terms: _t, ...rest } = s;
        return rest;
      }
      if (s.id === "engaged") {
        const { action: _a, ...rest } = s;
        return rest;
      }
      return s;
    });
    b.lines = b.lines.map((l) => {
      if (l.id !== "signed") return l;
      const { offer: _o, ...rest } = l;
      return rest;
    });
    expect(why(b)).toEqual(
      [
        'Station "engaged" has no action, so it cannot become a step.',
        'Cash station "standard" has no terms, so it cannot become a plan.',
        'Deal station "signed" is on a line without an offer.',
      ].sort((x, y) => why(b).indexOf(x) - why(b).indexOf(y)),
    );
  });

  it("refuses a back track at the hub", () => {
    const b = base();
    b.tracks.push({ id: "again", from: "engaged", to: HUB, kind: "back", by: "person" });
    expect(why(b)).toEqual([
      'Track "again" is a back track at the hub. The graph has no hub to loop to.',
    ]);
  });

  it("lets graphOf run on a body that is not lowerable, leaving out what it cannot lower", () => {
    const m = metroShape();
    const g = graphOf(m);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const gone of [
      "hub",
      "qualify",
      "wait",
      "gone",
      "fork",
      "merge",
      "test",
      "review",
      "shared",
      "done",
    ]) {
      expect(ids.has(gone)).toBe(false);
    }
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    expect(g.nodes.find((n) => n.id === "signed")).toMatchObject({
      kind: "offer",
      offer: "offer-a",
    });
    expect(g.nodes.find((n) => n.id === "pay")).toMatchObject({ kind: "plan", terms: "standard" });
    expect(g.edges.find((e) => e.id === "renew")).toMatchObject({
      kind: "loop",
      label: "after 90 days",
    });
    expect(g.edges.map((e) => e.id)).toContain("social_to_reply");
    expect(g.edges.map((e) => e.id)).toContain("list_to_reply");
    expect(g.edges.map((e) => e.id)).not.toContain("team_to_reply");
  });
});

describe("placesOf", () => {
  it.each([
    ["the starter", () => starterShape().body],
    ["wideShape()", () => wideShape()],
    ["shape()", () => shape()],
  ])("orders the holding nodes of %s as depthOf does", (_name, make) => {
    const g = make();
    const depth = depthOf(g);
    const place = placesOf(made(g).body);
    const held = g.nodes.filter(holds);
    for (const a of held) {
      for (const b of held) {
        const da = depth[a.id] ?? 0;
        const db = depth[b.id] ?? 0;
        if (da < db) expect(place[a.id] ?? -1).toBeLessThan(place[b.id] ?? -1);
      }
    }
  });

  it("gives out stations 0, the hub 1, and a station after the hub 2", () => {
    const place = placesOf(made(shape()).body);
    expect(place).toMatchObject({ yt: 0, mail: 0, hub: 1, engaged: 2 });
  });

  it("is column first: a later column starts past every place of an earlier one", () => {
    const m = made(shape()).body;
    // booked is the first sales station. It is one past engaged, the last marketing place.
    const place = placesOf(m);
    expect(place.booked).toBe((place.engaged ?? 0) + 1);
    // A sales station with no in-track still starts past the marketing columns.
    m.stations.push({
      id: "lone",
      label: "Lone",
      kind: "att",
      line: "signed",
      column: "sales",
      action: "other",
    });
    expect(placesOf(m).lone).toBe((place.engaged ?? 0) + 1);
  });

  it("is safe on a body that is not checked: unknown ids, a loop, a track that runs left", () => {
    const m: MetroBody = {
      model: "metro",
      name: "Odd",
      lines: [],
      stations: [
        { id: "a", label: "A", kind: "att", column: "sales" },
        { id: "b", label: "B", kind: "att", column: "marketing" },
        { id: "c", label: "C", kind: "att", column: "sales" },
      ],
      tracks: [
        { id: "ab", from: "a", to: "b", by: "system" },
        { id: "ac", from: "a", to: "c", by: "system" },
        { id: "ca", from: "c", to: "a", by: "system" },
        { id: "zz", from: "ghost", to: "a", by: "system" },
        { id: "self", from: "a", to: "a", by: "system" },
      ],
      groups: [],
      frames: [],
    };
    const place = placesOf(m);
    expect(Object.keys(place).sort()).toEqual(["a", "b", "c"]);
    expect(place.b).toBe(0);
  });

  it("ignores back tracks and exit tracks", () => {
    const m = made(shape()).body;
    m.tracks.push({ id: "again", from: "standard", to: "engaged", kind: "back", by: "person" });
    const place = placesOf(m);
    expect(place.engaged).toBe(2);
  });
});

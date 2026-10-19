import { describe, expect, it } from "vitest";
import { ctx } from "../test/fixtures.js";
import { type FunnelBody, type FunnelInput, shapeFromFunnels } from "./migrate.js";
import { checkShape, depthOf } from "./model.js";

const funnel = (
  id: string,
  over: Partial<FunnelBody> = {},
  status: FunnelInput["status"] = "live",
): FunnelInput => ({
  id,
  status,
  body: {
    name: `Funnel ${id}`,
    offer: "offer-a",
    stages: [
      { key: "reply", label: "Replied", on: [{ trigger: "trigger.reply" }] },
      { key: "booked", label: "Booked", on: [{ trigger: "trigger.booking" }] },
      { key: "won", label: "Won", sale: true, on: [{ trigger: "trigger.document" }] },
    ],
    entries: [{ id: "yt", kind: "organic", channel: "youtube" }],
    ...over,
  },
});

const plan = (...fs: FunnelInput[]) => {
  const p = shapeFromFunnels(fs);
  if (!p) throw new Error("no plan");
  return p;
};

const ids = (p: ReturnType<typeof plan>, kind: string) =>
  p.body.nodes.filter((n) => n.kind === kind).map((n) => n.id);

describe("one funnel", () => {
  const p = plan(funnel("main"));

  it("gives a shape that passes the rules", () => {
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("makes a source per entry and a node per stage", () => {
    expect(ids(p, "source")).toEqual(["yt"]);
    expect(ids(p, "step")).toEqual(["reply", "booked"]);
    expect(ids(p, "offer")).toEqual(["won"]);
  });

  it("takes the shape's name from the funnel", () => {
    expect(p.body.name).toBe("Funnel main");
  });

  it("names the action after the stage key when it is one, else other", () => {
    const step = (id: string) => p.body.nodes.find((n) => n.id === id);
    expect(step("reply")).toMatchObject({ kind: "step", action: "reply" });
    expect(step("booked")).toMatchObject({ kind: "step", action: "other" });
  });

  it("puts the funnel's offer on the sale stage", () => {
    expect(p.body.nodes.find((n) => n.id === "won")).toMatchObject({
      kind: "offer",
      offer: "offer-a",
      advance: [{ trigger: "trigger.document" }],
    });
  });

  it("links consecutive stages and each entry to its first stage", () => {
    expect(p.body.edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual([
      "reply>booked:flow",
      "booked>won:flow",
      "yt>reply:flow",
    ]);
    expect(depthOf(p.body)).toEqual({ yt: 0, reply: 1, booked: 2, won: 3 });
  });

  it("maps the old keys to the new ids", () => {
    expect(p.nodes).toEqual({ main: { reply: "reply", booked: "booked", won: "won" } });
    expect(p.sources).toEqual({ main: { yt: "yt" } });
    expect(p.offers).toEqual({ main: "won" });
  });

  it("is the same every time", () => {
    expect(plan(funnel("main"))).toEqual(p);
  });
});

describe("no funnels", () => {
  it("gives no plan", () => {
    expect(shapeFromFunnels([])).toBeNull();
  });
});

describe("an entry that opens past the first stage", () => {
  it("links the source to that stage", () => {
    const p = plan(funnel("main", { entries: [{ id: "ref", kind: "referral", to: "booked" }] }));
    expect(p.body.edges).toContainEqual({
      id: "ref_to_booked",
      from: "ref",
      to: "booked",
      kind: "flow",
    });
    expect(checkShape(p.body, ctx())).toEqual([]);
  });
});

describe("a funnel with no entries", () => {
  it("opens by hand from one manual source", () => {
    const p = plan(funnel("main", { entries: [] }));
    expect(p.body.nodes.find((n) => n.kind === "source")).toMatchObject({
      id: "manual",
      via: "manual",
    });
    expect(p.body.edges).toContainEqual(expect.objectContaining({ from: "manual", to: "reply" }));
    expect(checkShape(p.body, ctx())).toEqual([]);
  });
});

describe("two funnels", () => {
  it("share a node when the key, label and kind agree", () => {
    const p = plan(funnel("a"), funnel("b"));
    expect(ids(p, "step")).toEqual(["reply", "booked"]);
    expect(p.nodes.b).toEqual(p.nodes.a);
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("join the triggers of a shared node", () => {
    const p = plan(
      funnel("a"),
      funnel("b", {
        stages: [
          { key: "reply", label: "Replied", on: [{ trigger: "trigger.touch" }] },
          { key: "won", label: "Won", sale: true, on: [{ trigger: "trigger.document" }] },
        ],
      }),
    );
    expect(p.body.nodes.find((n) => n.id === "reply")).toMatchObject({
      advance: [{ trigger: "trigger.reply" }, { trigger: "trigger.touch" }],
    });
  });

  it("split a key whose label differs", () => {
    const p = plan(
      funnel("a"),
      funnel("b", {
        stages: [
          { key: "reply", label: "Wrote back", on: [] },
          { key: "won", label: "Won", sale: true, on: [] },
        ],
      }),
    );
    expect(p.nodes.b).toEqual({ reply: "reply_b", won: "won" });
    expect(ids(p, "step")).toEqual(["reply", "booked", "reply_b"]);
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("split a key whose kind differs", () => {
    const p = plan(
      funnel("a"),
      funnel("b", {
        stages: [{ key: "booked", label: "Booked", sale: true, on: [] }],
      }),
    );
    expect(p.nodes.b).toEqual({ booked: "booked_b" });
    expect(p.body.nodes.find((n) => n.id === "booked_b")).toMatchObject({ kind: "offer" });
  });

  it("split a sale stage that sells another offer", () => {
    const p = plan(funnel("a"), funnel("b", { offer: "offer-b" }));
    expect(p.nodes.b?.won).toBe("won_b");
    expect(p.offers).toEqual({ a: "won", b: "won_b" });
  });

  it("do not share a node when that would close a loop", () => {
    const p = plan(
      funnel("a", {
        stages: [
          { key: "x", label: "X", on: [] },
          { key: "y", label: "Y", sale: true, on: [] },
        ],
      }),
      funnel("b", {
        stages: [
          { key: "y", label: "Y", sale: true, on: [] },
          { key: "x", label: "X", on: [] },
        ],
      }),
    );
    expect(p.nodes.b).toEqual({ y: "y_b", x: "x_b" });
    expect(p.notes[0]).toMatch(/loop/);
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("merge identical entries and split the same id with other settings", () => {
    const p = plan(
      funnel("a", {
        entries: [
          { id: "yt", kind: "organic", channel: "youtube" },
          { id: "mail", kind: "outbound", channel: "email" },
        ],
      }),
      funnel("b", {
        entries: [
          { id: "yt", kind: "organic", channel: "youtube" },
          { id: "mail", kind: "outbound", channel: "email", campaign: "spring" },
        ],
      }),
    );
    expect(ids(p, "source")).toEqual(["yt", "mail", "mail_b"]);
    expect(p.sources).toEqual({ a: { yt: "yt", mail: "mail" }, b: { yt: "yt", mail: "mail_b" } });
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("keep an entry id apart from a stage id", () => {
    const p = plan(funnel("a", { entries: [{ id: "booked", kind: "referral" }] }));
    expect(p.sources.a).toEqual({ booked: "booked_a" });
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("link a funnel entry from the feeder's sale stage", () => {
    const p = plan(
      funnel("a"),
      funnel("b", {
        stages: [
          { key: "onboard", label: "Onboard", on: [] },
          { key: "live", label: "Live", sale: true, on: [] },
        ],
        entries: [{ id: "from_a", kind: "funnel", funnel: { id: "a" } }],
      }),
    );
    expect(p.body.edges).toContainEqual({
      id: "won_to_onboard",
      from: "won",
      to: "onboard",
      kind: "flow",
    });
    expect(ids(p, "source")).toEqual(["yt"]);
    expect(checkShape(p.body, ctx())).toEqual([]);
  });

  it("link a funnel entry from the stage it names", () => {
    const p = plan(
      funnel("a"),
      funnel("b", {
        stages: [{ key: "onboard", label: "Onboard", sale: true, on: [] }],
        entries: [{ id: "from_a", kind: "funnel", funnel: { id: "a", at: "booked" } }],
      }),
    );
    expect(p.body.edges).toContainEqual(
      expect.objectContaining({ from: "booked", to: "onboard", kind: "flow" }),
    );
  });

  it("send a funnel entry that would close a loop along a loop edge", () => {
    const p = plan(
      funnel("a", {
        entries: [
          { id: "yt", kind: "organic", channel: "youtube" },
          { id: "again", kind: "funnel", funnel: { id: "b" }, to: "reply" },
        ],
      }),
      funnel("b", {
        stages: [
          { key: "reply", label: "Replied", on: [] },
          { key: "paid", label: "Paid", sale: true, on: [] },
        ],
        entries: [{ id: "yt", kind: "organic", channel: "youtube" }],
      }),
    );
    expect(checkShape(p.body, ctx())).toEqual([]);
    expect(p.body.edges.filter((e) => e.kind === "loop")).toHaveLength(1);
  });

  it("park the sources of an off funnel and keep them apart from a live twin", () => {
    const p = plan(funnel("a"), funnel("b", {}, "off"));
    const sources = p.body.nodes.filter((n) => n.kind === "source");
    expect(sources.map((s) => [s.id, "parked" in s ? s.parked : undefined])).toEqual([
      ["yt", undefined],
      ["yt_b", true],
    ]);
  });
});

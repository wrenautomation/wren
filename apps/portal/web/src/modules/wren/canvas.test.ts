// The Workflows canvas's nodes, live numbers and event dots (graphOf, dotsOf).
import { wireLines } from "@wren/ui";
import { describe, expect, it } from "vitest";
import type { Drawn } from "../marketplace/boxes.js";
import {
  type Count,
  DEPTH_MAX,
  deeper,
  dotsOf,
  funnelOf,
  graphOf,
  portKey,
  portsIn,
  trailIsFor,
} from "./canvas.js";

const node = (id: string, more: Partial<Drawn["nodes"][number]> = {}) => ({
  id,
  uses: `x.${id}`,
  name: id,
  note: null,
  ready: "ready" as const,
  ...more,
});
const LEADS = { record: "a.lead", view: "all" };
const REPLIES = { record: "a.reply", view: "all" };
const inner: Drawn = {
  id: "sales",
  name: "Sales",
  in: [],
  out: [{ id: "won", label: "clients won", kind: "client" }] as Drawn["out"],
  nodes: [
    node("find", { count: { ...LEADS, label: "leads" } }),
    node("mail", { count: { ...REPLIES, label: "replies" } }),
    node("close", { ready: "planned" }),
  ],
  wires: [
    { from: "find.leads", to: "mail.leads", via: "code", label: "leads", count: LEADS },
    { from: "mail.replied", to: "close.replies", via: "code", label: "replies", count: REPLIES },
    { from: "mail.quiet", to: "mail.leads", via: "code", label: "never replied", wait: "3 days" },
    { from: "close.won", to: "out.won", via: "events", label: "clients won" },
  ] as Drawn["wires"],
};
const root: Drawn = {
  id: "co",
  name: "Co",
  in: [],
  out: [],
  nodes: [node("sales", { uses: "sales", opens: "sales", ready: "planned" }), node("books")],
  wires: [],
};
const counts = new Map<string, Count>([
  ["a.lead:all", { value: 412, today: 9 }],
  ["a.reply:all", { value: 31, today: 2 }],
  [portKey({ workflow: "sales", node: "out", port: "won" }), { value: 3, today: 0 }],
]);
const where = {
  canvas: (n: { opens?: string | null }) => `/canvas/${n.opens}`,
  rows: (c: { record: string }) => `/rows/${c.record}`,
};

describe("graphOf", () => {
  const { nodes, edges } = graphOf(inner, { counts, where, team: true });

  it("numbers each card for 30 days and today, linked to its rows", () => {
    expect(nodes.find((n) => n.id === "find")?.number).toEqual({
      value: 412,
      today: 9,
      label: "leads",
      href: "/rows/a.lead",
    });
    expect(nodes.find((n) => n.id === "close")).toMatchObject({
      state: { label: "In development" },
      dim: true,
    });
  });

  it("rates a wire against what came into the card it leaves", () => {
    const out = edges.find((e) => e.from === "mail");
    expect(wireLines(out ?? { from: "", to: "" })).toEqual([
      "31 replies · 2 today",
      "412 → 31, 7.5%",
    ]);
    // The first wire counts what its card counts: no rate against itself.
    expect(edges.find((e) => e.from === "find")?.rate).toBeUndefined();
  });

  it("counts an uncounted wire's arrivals; a wire back into its card is a line on it", () => {
    expect(portsIn(inner)).toEqual([{ workflow: "sales", node: "out", port: "won" }]);
    expect(edges.find((e) => e.to === "out.won")?.count).toEqual({ value: 3, today: 0 });
    expect(nodes.find((n) => n.id === "mail")?.lines).toEqual([
      { text: "Again after 3 days: never replied" },
    ]);
    expect(nodes.at(-1)).toMatchObject({ id: "out.won", dashed: true });
  });

  it("gives a workflow card its inside's first number and furthest one, not words", () => {
    const top = graphOf(root, { counts, inner: new Map([["sales", inner]]), where, team: true });
    const sales = top.nodes.find((n) => n.id === "sales");
    expect(sales).toMatchObject({
      kind: "workflow",
      stacked: true,
      href: "/canvas/sales",
      state: { label: "Parts in development" },
      number: { value: 412, label: "leads" },
      more: { value: 31, label: "replies" },
    });
    expect(sales?.dim).toBe(false);
  });
});

describe("funnelOf", () => {
  it("lists counted stages in order, each rated against the one before", () => {
    expect(funnelOf(inner, counts)).toEqual([
      { label: "Leads", value: 412, note: undefined },
      { label: "Replies", value: 31, note: "7.5% of the stage before" },
    ]);
    expect(funnelOf(root, counts)).toEqual([]);
  });
});

describe("dotsOf", () => {
  const at = "2026-01-01T00:00:00Z";
  it("puts an event on the wire it arrived by, or washes the card it happened inside", () => {
    expect(
      dotsOf(
        [
          { id: "1", workflow: "sales", node: "close", port: "replies", state: "failed", at },
          { id: "2", workflow: "sales", node: "out", port: "won", state: "passed", at },
          { id: "3", workflow: "other", node: "a", port: "b", state: "passed", at },
        ],
        inner,
      ),
    ).toEqual([
      { id: "1", edge: "mail>close", tone: "bad" },
      { id: "2", edge: "close>out.won", tone: "accent" },
    ]);
    expect(
      dotsOf(
        [{ id: "4", workflow: "sales", node: "out", port: "held", state: "passed", at }],
        root,
      ),
    ).toEqual([{ id: "4", node: "sales", tone: "warn" }]);
  });
});

describe("deeper", () => {
  it("never opens a workflow already on the path, and stops at the cap", () => {
    expect(deeper(["wren"], "outbound")).toEqual(["wren", "outbound"]);
    expect(deeper(["wren", "outbound"], "outbound")).toBeNull();
    expect(deeper(["wren", "outbound", "email"], "wren")).toBeNull();
    const far = Array.from({ length: DEPTH_MAX }, (_, i) => `w${i}`);
    expect(deeper(far, "next")).toBeNull();
  });

  it("draws a trail only under its own path", () => {
    const wren = { workflow: { id: "wren" } };
    const outbound = { workflow: { id: "outbound" } };
    // The old answer, still shown while the next path loads: Play must not start on it.
    expect(trailIsFor(["wren", "outbound"], [wren])).toBe(false);
    expect(trailIsFor(["wren", "outbound"], [wren, wren])).toBe(false);
    expect(trailIsFor(["wren", "outbound"], [wren, outbound])).toBe(true);
    expect(trailIsFor(["wren"], null)).toBe(false);
  });
});

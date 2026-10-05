// What the Map draws from the catalog's rows (mapOf).
import { describe, expect, it } from "vitest";
import { countsIn, type Drawn, flowBoxes, mapOf } from "./boxes.js";

const row = (id: string, needs: string | null, more: Record<string, string> = {}) => ({
  id,
  name: id,
  needs,
  ready: "ready",
  for: "client",
  installed: null,
  ...more,
});

describe("mapOf", () => {
  const rows = [
    row("a.base", null),
    row("a.top", "a.base, gmail", { installed: "no" }),
    row("b.alone", null),
    row("c.top", "meta"),
  ];
  const { groups, alone } = mapOf(rows, (id) => `/x/${id}`);
  const boxes = groups[0] ?? [];

  it("needs that name a part are edges; the rest are account inputs, drawn last", () => {
    expect(boxes.map((b) => b.id)).toEqual(["a.base", "a.top", "@gmail"]);
    expect(boxes[2]).toMatchObject({ label: "Gmail account", input: true, after: [] });
    expect(boxes.find((b) => b.id === "a.top")?.after).toEqual(["a.base", "@gmail"]);
  });

  it("groups share no line, biggest first", () => {
    expect(groups.map((g) => g.map((b) => b.id))).toEqual([
      ["a.base", "a.top", "@gmail"],
      ["c.top", "@meta"],
    ]);
  });

  it("not installed is dim; parts with no edges stand alone", () => {
    expect(boxes.find((b) => b.id === "a.top")?.dim).toBe(true);
    expect(boxes.find((b) => b.id === "a.base")?.dim).toBe(false);
    expect(alone.map((b) => [b.id, b.href])).toEqual([["b.alone", "/x/b.alone"]]);
  });
});

describe("flowBoxes", () => {
  const ref = { record: "x.reply", view: "all" };
  const w: Drawn = {
    id: "out",
    name: "Out",
    in: [],
    out: [{ id: "won", label: "clients won", kind: "client" }],
    nodes: [
      {
        id: "mail",
        uses: "x.mail",
        name: "Mail",
        note: null,
        ready: "ready",
        count: { ...ref, label: "replies" },
      },
      {
        id: "close",
        uses: "close.part",
        name: "Close",
        note: null,
        ready: "planned",
        opens: "close",
      },
    ],
    wires: [
      { from: "mail.quiet", to: "mail.leads", via: "code", wait: "90 days", label: "quiet leads" },
      {
        from: "mail.replied",
        to: "close.calls",
        via: "code",
        label: "replies",
        count: ref,
        when: "they ask",
      },
      { from: "close.won", to: "out.won", via: "events", label: "clients won" },
    ],
  };
  it("labels lines with their numbers, folds a loop into its node, and ends at the outputs", () => {
    expect(countsIn(w)).toEqual([ref]);
    const [mail, close, won] = flowBoxes(
      w,
      (n) => n.opens ?? undefined,
      new Map([["x.reply:all", 1204]]),
    );
    expect(mail).toMatchObject({
      count: "1,204 replies",
      note: "Again after 90 days: quiet leads",
      after: [],
    });
    expect(close).toMatchObject({
      after: ["mail"],
      labels: { mail: "1,204 replies\nif they ask" },
      note: "In development",
      dim: true,
      stacked: true,
      href: "close",
    });
    const flow = { ...w, nodes: [{ ...w.nodes[1], uses: "close" } as Drawn["nodes"][number]] };
    expect(flowBoxes(flow, () => undefined)[0]).toMatchObject({
      note: "Parts in development",
      dim: false,
    });
    expect(won).toMatchObject({ id: "out.won", after: ["close"], input: true });
  });
});

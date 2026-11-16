import { describe, expect, it } from "vitest";
import { BOARD_VIEW } from "../../mocks/data/research-board.js";
import { type BoardPage, boardPages } from "./board.js";
import type { PageTraits } from "./serve.js";
import { pickSplits } from "./splits.js";

const AT = Date.parse("2026-11-16T00:00:00Z");

/** a page with only what the traits read */
const page = (
  id: string,
  o: {
    pick?: number;
    length?: number;
    platform?: string;
    multiple?: number | null;
    traits?: PageTraits;
  } = {},
): BoardPage =>
  ({
    s: { id, url: `https://x.com/a/status/${id}`, kept: 0, dropped: 0 },
    d: {
      id,
      media: o.length != null ? "video" : "page",
      length: o.length,
      speaker: { value: "person", by: "agent" },
      traits: o.traits,
    },
    r: { platform: o.platform ?? "x", multiple: o.multiple ?? null, followers: null },
    pick: o.pick != null ? { id, rank: o.pick, why: "", by: "a" } : undefined,
  }) as unknown as BoardPage;

describe("pickSplits", () => {
  it("finds the trait the picks share and the rest lack", () => {
    const pages = [
      page("p1", { pick: 1, length: 30 }),
      page("p2", { pick: 2, length: 45 }),
      page("p3", { pick: 3, length: 50 }),
      page("p4", { pick: 4, length: 400 }),
      page("r1", { length: 300 }),
      page("r2", { length: 240 }),
      page("r3", { length: 20 }),
      page("r4", { length: 600 }),
    ];
    const short = pickSplits(pages, AT).find((s) => s.id === "short");
    expect(short?.picks).toEqual({ yes: 3, of: 4 });
    expect(short?.rest).toEqual({ yes: 1, of: 4 });
    expect(short?.on.map((p) => p.s.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("splits a stored trait at the run's median, and a rare count at 0", () => {
    const t = (cutsPerMin: number, tables = 0) => ({ traits: { cutsPerMin, tables } });
    const pages = [
      page("p1", { pick: 1, ...t(30, 1) }),
      page("p2", { pick: 2, ...t(24, 1) }),
      page("p3", { pick: 3, ...t(18) }),
      page("r1", t(2)),
      page("r2", t(4)),
      page("r3", t(20)),
      page("r4"),
    ];
    const splits = pickSplits(pages, AT);
    const cuts = splits.find((s) => s.id === "t:cutsPerMin");
    expect(cuts?.label).toBe("cut more than 19 times a minute");
    expect(cuts?.picks).toEqual({ yes: 2, of: 3 });
    // r4 has no traits: not counted
    expect(cuts?.rest).toEqual({ yes: 1, of: 3 });
    expect(splits.find((s) => s.id === "t:tables")?.picks).toEqual({ yes: 2, of: 3 });
  });

  it("leaves out a trait known for too few pages, and a gap under 20 points", () => {
    const pages = [
      page("p1", { pick: 1, multiple: 20 }),
      page("p2", { pick: 2 }),
      page("p3", { pick: 3 }),
      page("r1"),
      page("r2"),
      page("r3"),
    ];
    const ids = pickSplits(pages, AT).map((s) => s.id);
    // one pick has a multiple: unknown for the rest
    expect(ids).not.toContain("hot");
    // every page is on X: no gap
    expect(ids).not.toContain("on:x");
  });

  it("says nothing with under 3 picks", () => {
    expect(pickSplits([page("p1", { pick: 1 }), page("r1"), page("r2"), page("r3")], AT)).toEqual(
      [],
    );
  });

  it("runs on the board fixture", () => {
    const s = pickSplits([...boardPages(BOARD_VIEW).values()], AT);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(Math.abs(x.gap)).toBeGreaterThanOrEqual(0.2);
  });
});

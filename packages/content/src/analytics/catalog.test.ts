import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CATALOG,
  CATALOG_TABLES,
  catalogCounts,
  entriesFor,
  formatOf,
  stateLine,
} from "./catalog.js";

const DOC = new URL("../../../../designs/2026-10-07-content-analytics.md", import.meta.url);

/** The doc's Counts table, row by row: label, then Live, Needs scope, Needs William, Not built, No API. */
function docCounts(): Map<string, number[]> {
  const text = readFileSync(DOC, "utf8");
  const at = text.indexOf("| Platform | Live |");
  const rows = text.slice(at).split("\n").slice(2);
  const out = new Map<string, number[]>();
  for (const line of rows) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    out.set(cells[0] ?? "", cells.slice(1).map(Number));
  }
  return out;
}

describe("analytics catalog", () => {
  it("the design doc's counts are the catalog's", () => {
    const doc = docCounts();
    for (const c of catalogCounts()) {
      if (c.label === "Every platform") continue;
      expect([c.label, doc.get(c.label)]).toEqual([
        c.label,
        [c.live, c.needs_scope, c.needs_william, c.not_built, c.no_api],
      ]);
    }
    expect(doc.size).toBe(CATALOG_TABLES.length - 1);
  });

  it("every gap that needs a step names it", () => {
    for (const e of ANALYTICS_CATALOG)
      if (e.state === "needs_scope" || e.state === "needs_william")
        expect(e.needs?.step, e.label).toBeTruthy();
  });

  it("a Short reads as long-form plus its own rows; a long video leaves those out", () => {
    const short = entriesFor("youtube", "short").map((e) => e.label);
    expect(short).toContain("Engaged views");
    expect(short).toContain("Traffic sources");
    expect(short).toContain("Comment reply rate and time to reply");
    expect(entriesFor("youtube", "long").map((e) => e.label)).not.toContain("Engaged views");
  });

  it("formats and the words a state says", () => {
    expect(formatOf("youtube", "short")).toBe("short");
    expect(formatOf("youtube", "video")).toBe("long");
    expect(formatOf("instagram", "video")).toBe("reel");
    expect(formatOf("linkedin", "document")).toBe("carousel");
    expect(formatOf("x", "thread")).toBe("thread");
    expect(stateLine("needs_scope", { name: "YouTube Analytics", step: "x" })).toBe(
      "Needs scope: YouTube Analytics",
    );
    expect(stateLine("not_built")).toBe("In development");
  });
});

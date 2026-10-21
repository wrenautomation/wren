import { describe, expect, it } from "vitest";
import { layoutMetro, lineKeyOf, SPACE } from "./layout.js";
import {
  COLD_OUTBOUND_VIEW,
  DIFF_VIEW,
  DOWNSELL_VIEW,
  LADDER_VIEW,
  LATE_VIEW,
  PLANNED_VIEW,
  REFERRAL_VIEW,
  SAMPLE_VIEWS,
  WEBINAR_VIEW,
} from "./samples.js";
import { isMark } from "./types.js";
import type { MetroView } from "./view.js";

const at = (scene: ReturnType<typeof layoutMetro>, id: string) => {
  const s = scene.st.find((m) => m.id === id);
  if (!s || !isMark(s)) throw new Error(`no station ${id}`);
  return s;
};

describe("layoutMetro", () => {
  it("is pure: the same view gives the same scene, and the view is not changed", () => {
    const before = JSON.stringify(COLD_OUTBOUND_VIEW);
    expect(layoutMetro(COLD_OUTBOUND_VIEW)).toEqual(layoutMetro(COLD_OUTBOUND_VIEW));
    expect(JSON.stringify(COLD_OUTBOUND_VIEW)).toBe(before);
  });

  it("draws every sample view", () => {
    for (const v of SAMPLE_VIEWS) {
      const s = layoutMetro(v);
      expect(s.st.length, v.title).toBeGreaterThan(0);
      expect(s.tr.length, v.title).toBeGreaterThan(0);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
    }
  });

  it("puts stations in column order, left to right", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    const z = s.zones ?? [];
    expect(z.map((r) => r[2])).toEqual(["Marketing", "Sales", "Delivery", "Money"]);
    for (let i = 1; i < z.length; i++) expect(z[i]?.[0]).toBe(z[i - 1]?.[1]);
    for (const m of s.st) {
      const col = COLD_OUTBOUND_VIEW.stations.find((v) => v.id === m.id)?.column;
      const zone = z.find((r) => r[2] === col);
      expect(m.x, m.id).toBeGreaterThanOrEqual(zone?.[0] ?? 0);
      expect(m.x, m.id).toBeLessThan(zone?.[1] ?? 0);
    }
  });

  it("sits the hub after the stations that lead into it and spans every row", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    const hub = at(s, "hub");
    expect(hub.t).toBe("hub");
    expect(hub.x).toBeGreaterThan(at(s, "c1").x ?? 0);
    expect(hub.span?.[0]).toBe(SPACE.top);
    expect(hub.span?.[1]).toBeGreaterThan(SPACE.top);
    // Outreach ends at the hub on its own row; a line starts at the hub and drops to its row.
    const into = s.tr.find((t) => t.b === "hub");
    const out = s.tr.find((t) => t.a === "hub");
    expect(into?.l).toBe("out");
    expect(into?.w).toBe("out");
    expect(out?.oa).toBeGreaterThan(0);
  });

  it("gives each line a weight from its tier", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    expect(s.tr.find((t) => t.a === "rep" && t.b === "bk")?.w).toBe("core");
    const f = layoutMetro(LATE_VIEW);
    expect(f.tr.find((t) => t.a === "form" && t.b === "bk")?.w).toBe("front");
  });

  it("puts an exit under its source and joins it with an exit track", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    const lost = at(s, "lost");
    const held = at(s, "held");
    expect(lost.x).toBe(held.x);
    expect(lost.y).toBe(held.y + SPACE.exit);
    expect(s.tr.find((t) => t.b === "lost")?.k).toBe("exit");
  });

  it("shows the owner and promise on a person track, and rings a late one", () => {
    const s = layoutMetro(LATE_VIEW);
    const t = s.tr.find((r) => r.a === "form" && r.b === "bk");
    expect(t?.who).toBe("WJ · 5m → 3h");
    expect(t?.late).toBe(true);
    const calm = layoutMetro(COLD_OUTBOUND_VIEW);
    expect(calm.tr.find((r) => r.a === "rep")?.late).toBeUndefined();
  });

  it("draws a move to another line as a transfer in the colour of the line joined", () => {
    const s = layoutMetro(PLANNED_VIEW);
    const x = s.tr.find((t) => t.k === "xfer");
    expect(x?.l).toBe("be");
    expect(x?.lab).toBe("transfer");
    expect(s.colours?.be).toBe(4);
    expect(at(s, "be").t).toBe("plan");
    const d = layoutMetro(DOWNSELL_VIEW);
    expect(d.tr.find((t) => t.b === "ob")?.lab).toBe("downsell");
  });

  it("draws a planned track dotted", () => {
    const s = layoutMetro(REFERRAL_VIEW);
    expect(s.tr.find((t) => t.b === "ask")?.k).toBe("plan");
  });

  it("names lines and colours only the offers", () => {
    const s = layoutMetro(WEBINAR_VIEW);
    expect(s.lines?.web).toEqual({ n: "Webinar", l: "web" });
    expect(s.colours).toEqual({ web: 0, gp: 2 });
    expect(Object.keys(s.colours ?? {})).not.toContain("yt");
  });

  it("drops a track whose station is missing", () => {
    const v: MetroView = {
      ...COLD_OUTBOUND_VIEW,
      tracks: [...COLD_OUTBOUND_VIEW.tracks, { from: "rep", to: "ghost", by: "system" }],
    };
    const s = layoutMetro(v);
    expect(s.tr).toHaveLength(COLD_OUTBOUND_VIEW.tracks.length);
    expect(s.tr.some((t) => t.b === "ghost")).toBe(false);
  });

  it("appends a column that the default columns do not list", () => {
    const v: MetroView = {
      title: "x",
      lines: [{ id: "a", tier: "core", colour: 0, offer: "A" }],
      stations: [
        { id: "s1", kind: "att", line: "a", column: "One" },
        { id: "s2", kind: "cash", line: "a", column: "Two" },
      ],
      tracks: [{ from: "s1", to: "s2", by: "system" }],
    };
    const s = layoutMetro(v);
    expect(s.zones?.map((z) => z[2])).toEqual([
      "Marketing",
      "Sales",
      "Delivery",
      "Money",
      "One",
      "Two",
    ]);
    expect(at(s, "s1").x).toBeLessThan(at(s, "s2").x ?? 0);
  });

  it("keeps stations on one row apart and never lets two stations overlap", () => {
    for (const v of SAMPLE_VIEWS) {
      const s = layoutMetro(v);
      const seen = new Set<string>();
      for (const m of s.st) {
        const k = `${m.x},${m.y}`;
        // The first-touch marker and the hub share the hub column on purpose in no sample.
        expect(seen.has(k), `${v.title}: ${m.id} at ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("keeps every station inside the scene", () => {
    for (const v of SAMPLE_VIEWS) {
      const s = layoutMetro(v);
      for (const m of s.st) {
        expect(m.x ?? 0, `${v.title}: ${m.id}`).toBeGreaterThan(0);
        expect(m.x ?? 0).toBeLessThan(s.w ?? 0);
        expect(m.y).toBeGreaterThan(0);
        expect(m.y).toBeLessThan(s.h);
      }
    }
  });

  it("grows the scene for a longer view", () => {
    const small = layoutMetro(PLANNED_VIEW);
    const big = layoutMetro(LADDER_VIEW);
    expect(big.w ?? 0).toBeGreaterThan(small.w ?? 0);
    expect(big.h).toBeGreaterThan(small.h);
  });
});

describe("track ids", () => {
  it("takes the view's track id as the scene track id", () => {
    const s = layoutMetro(DIFF_VIEW);
    expect(s.tr.map((t) => t.id)).toEqual(DIFF_VIEW.tracks.map((t) => t.id));
  });

  it("falls back to from-to without an id", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    expect(s.tr.find((t) => t.a === "rep" && t.b === "bk")?.id).toBe("rep-bk");
  });

  it("keeps ids apart when two tracks share one", () => {
    const v: MetroView = {
      ...COLD_OUTBOUND_VIEW,
      tracks: [
        { id: "same", from: "rep", to: "bk", by: "system" },
        { id: "same", from: "bk", to: "held", by: "system" },
      ],
    };
    const ids = layoutMetro(v).tr.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("same");
  });

  it("keeps an id on an exit, a hub track and a transfer", () => {
    const v: MetroView = {
      ...COLD_OUTBOUND_VIEW,
      tracks: COLD_OUTBOUND_VIEW.tracks.map((t) => ({ ...t, id: `x:${t.from}:${t.to}` })),
    };
    const s = layoutMetro(v);
    expect(s.tr.find((t) => t.b === "lost")?.id).toBe("x:held:lost");
    expect(s.tr.find((t) => t.a === "hub")?.id).toBe("x:hub:rep");
    expect(s.tr.find((t) => t.b === "hub")?.id).toBe("x:c1:hub");
    const p = layoutMetro({
      ...PLANNED_VIEW,
      tracks: PLANNED_VIEW.tracks.map((t) => ({ ...t, id: `x:${t.from}:${t.to}` })),
    });
    const x = p.tr.find((t) => t.k === "xfer");
    expect(x?.id).toBe(`x:${x?.a}:${x?.b}`);
  });
});

describe("diff marks", () => {
  const s = layoutMetro(DIFF_VIEW);

  it("passes a station's own mark and a track's own mark", () => {
    expect(at(s, "chk").mark).toBe("added");
    expect(at(s, "bk").mark).toBe("changed");
    expect(at(s, "old").mark).toBe("removed");
    expect(s.tr.find((t) => t.id === "t-yt-hub")?.mark).toBe("changed");
    expect(s.tr.find((t) => t.id === "t-chk-bk")?.mark).toBe("added");
    expect(s.tr.find((t) => t.id === "t-bk-pay")?.mark).toBe("removed");
    // An exit track keeps its mark too.
    expect(s.tr.find((t) => t.id === "t-bk-old")?.mark).toBe("removed");
  });

  it("puts a line's mark on its tracks and stations that have none of their own", () => {
    expect(at(s, "lan").mark).toBe("added");
    expect(at(s, "tix").mark).toBe("added");
    expect(s.tr.find((t) => t.id === "t-lan-tix")?.mark).toBe("added");
    // The track from the hub into the line joins it, so it is marked; the hub is not.
    expect(s.tr.find((t) => t.id === "t-hub-lan")?.mark).toBe("added");
    expect(at(s, "hub").mark).toBeUndefined();
  });

  it("leaves what has no mark unmarked, and lets a mark of its own beat the line's", () => {
    expect(at(s, "pay").mark).toBeUndefined();
    expect(s.tr.find((t) => t.id === "t-hub-chk")?.mark).toBeUndefined();
    const v: MetroView = {
      ...DIFF_VIEW,
      stations: DIFF_VIEW.stations.map((st) => (st.id === "tix" ? { ...st, mark: "changed" } : st)),
    };
    expect(at(layoutMetro(v), "tix").mark).toBe("changed");
  });

  it("is off when no mark is given", () => {
    const plain = layoutMetro(COLD_OUTBOUND_VIEW);
    expect(plain.st.some((m) => "mark" in m)).toBe(false);
    expect(plain.tr.some((t) => "mark" in t)).toBe(false);
  });
});

describe("lineKeyOf", () => {
  it("answers out for any outreach line and the id for an offer line", () => {
    expect(lineKeyOf(DIFF_VIEW, "yt")).toBe("out");
    expect(lineKeyOf(DIFF_VIEW, "web")).toBe("web");
    expect(lineKeyOf(DIFF_VIEW, "nope")).toBe("nope");
  });

  it("is the key the scene draws a line's marks with", () => {
    const s = layoutMetro(DIFF_VIEW);
    expect(s.lines?.yt?.l).toBe(lineKeyOf(DIFF_VIEW, "yt"));
    expect(s.lines?.gp?.l).toBe(lineKeyOf(DIFF_VIEW, "gp"));
  });
});

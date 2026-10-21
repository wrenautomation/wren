import { describe, expect, it } from "vitest";
import { crossingsOf, routeOf, sceneClashes, textWidth, trackEnds } from "./geometry.js";
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
import { isMark, type MetroScene, type Point } from "./types.js";
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

/** The clashes of one kind: the scene's own words start with these. */
const KIND = {
  names: /^name of /,
  chips: /^chip /,
  hub: /^track .* (passes under hub|enters hub|leaves hub)|^hub .* spans row/,
  gaps: /^gaps in columns/,
} as const;
const clashesOf = (scene: MetroScene, kind: keyof typeof KIND) =>
  sceneClashes(scene).filter((c) => KIND[kind].test(c));

/** Every sample view, drawn. The diff view has marks and a removed station. */
const DRAWN: [string, MetroView][] = [...SAMPLE_VIEWS, DIFF_VIEW].map((v) => [v.title ?? "", v]);

/** Crossings each sample had before the hub, the rows and the labels were laid out together. */
const CROSSINGS_BEFORE: Record<string, number> = {
  "Client becomes a channel": 1,
};

describe("a calm map", () => {
  it.each(DRAWN)("%s: no name sits on another name, a mark or a transfer label", (_t, v) => {
    expect(clashesOf(layoutMetro(v), "names")).toEqual([]);
  });

  it.each(DRAWN)("%s: no task chip sits on a mark, the hub or a name", (_t, v) => {
    expect(clashesOf(layoutMetro(v), "chips")).toEqual([]);
  });

  it.each(DRAWN)("%s: gaps in each column are equal, one step for the whole map", (_t, v) => {
    expect(clashesOf(layoutMetro(v), "gaps")).toEqual([]);
  });

  it.each(DRAWN)(
    "%s: no track passes under the hub, and the hub joins only the rows it spans",
    (_t, v) => {
      expect(clashesOf(layoutMetro(v), "hub")).toEqual([]);
    },
  );

  it.each(DRAWN)("%s: has no more crossings than before", (t, v) => {
    expect(crossingsOf(layoutMetro(v))).toBeLessThanOrEqual(CROSSINGS_BEFORE[t] ?? 0);
  });

  it.each(DRAWN)("%s: a task chip sits on its track, in the free part", (_t, v) => {
    const s = layoutMetro(v);
    const ends = trackEnds(s);
    for (const r of s.tr) {
      if (!r.at || !r.who) continue;
      const e = ends(r);
      const pts = e ? routeOf(r, e[0], e[1]) : [];
      expect(onRoute(pts, r.at), r.id).toBe(true);
    }
  });

  it("puts the hub's inputs left of it and each offer line's first station right of it", () => {
    const s = layoutMetro(DIFF_VIEW);
    const hub = at(s, "hub");
    expect(at(s, "yt").x).toBeLessThan(hub.x);
    expect(at(s, "lan").x).toBeGreaterThan(hub.x);
  });

  it("gives a column with no station a narrow width that still fits its name", () => {
    const s = layoutMetro(COLD_OUTBOUND_VIEW);
    const empty = (s.zones ?? []).filter(([a, b]) => {
      return !s.st.some((m) => isMark(m) && m.x > a && m.x < b);
    });
    expect(empty.length).toBeGreaterThan(0);
    for (const [a, b, name] of empty) {
      expect(b - a, name).toBeLessThan(SPACE.step);
      expect(b - a, name).toBeGreaterThanOrEqual(textWidth(name, 9.5, true));
    }
  });

  it("folds a chip to a count dot when its track has no room", () => {
    const v: MetroView = {
      ...COLD_OUTBOUND_VIEW,
      tracks: COLD_OUTBOUND_VIEW.tracks.map((t) =>
        t.from === "rep" && t.to === "bk"
          ? { ...t, by: "person", owner: "WJ", promise: "a promise that is much too long to fit" }
          : t,
      ),
    };
    const s = layoutMetro(v);
    const track = s.tr.find((t) => t.a === "rep" && t.b === "bk");
    expect(track?.dot).toBe(1);
    expect(track?.at).toBeDefined();
    expect(sceneClashes(s)).toEqual([]);
  });

  it("is the same scene each time", () => {
    for (const [, v] of DRAWN) expect(layoutMetro(v)).toEqual(layoutMetro(v));
  });
});

/** True when `p` lies on the polyline, within half a pixel. */
function onRoute(pts: Point[], p: Point): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1] as Point, pts[i] as Point];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    if (Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) <= 0.5) return true;
  }
  return false;
}

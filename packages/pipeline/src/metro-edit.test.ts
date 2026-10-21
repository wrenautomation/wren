import { describe, expect, it } from "vitest";
import { metroPair, metroShape } from "../test/fixtures.js";
import { canonicalJson } from "./diff.js";
import type { MetroBody } from "./metro.js";
import {
  diffMetro,
  type MetroChange,
  metroChangeKey,
  metroChangesOf,
  parseMetroChangeKey,
} from "./metro-diff.js";
import { undoMetroChange } from "./metro-edit.js";
import { Refused } from "./refused.js";

const change = (key: string): MetroChange => {
  const c = parseMetroChangeKey(key);
  if (!c) throw new Error(`not a key: ${key}`);
  return c;
};

/** The reasons an undo is refused. Fails when it is not refused. */
const refusal = (newest: MetroBody, a: MetroBody, b: MetroBody, key: string): string[] => {
  try {
    undoMetroChange(newest, a, b, change(key));
  } catch (e) {
    if (e instanceof Refused) return e.errors;
    throw e;
  }
  throw new Error(`${key} was not refused`);
};

const keysOf = (from: MetroBody, to: MetroBody): string[] =>
  metroChangesOf(diffMetro(from, to)).map(metroChangeKey).sort();

const inverse = {
  added: "removed",
  removed: "added",
  renamed: "renamed",
  changed: "changed",
} as const;

/** The key of the opposite change: added becomes removed, and so on. */
const inverseKey = (c: MetroChange): string =>
  c.on === "name" ? "name" : metroChangeKey({ ...c, how: inverse[c.how] } as MetroChange);

/** Changes whose undo takes more with it, and what comes with each. */
const CASCADES: Record<string, string[]> = {
  "station:fresh:added": ["track:fresh_to_review:removed"],
  "station:docs:removed": ["track:fork_to_docs:added", "track:docs_to_merge:added"],
};

/** Tracks that left with a removed station: alone, their undo has no end to join. */
const ENDS_MISSING: Record<string, string> = {
  "track:fork_to_docs:removed": "Track Fork to Docs needs station Docs, which is not in the shape.",
  "track:docs_to_merge:removed":
    "Track Docs to Ready needs station Docs, which is not in the shape.",
};

/** A copy of a body with a few edits, for a case that needs a newer body than the pair. */
const edited = (body: MetroBody, edit: (b: MetroBody) => void): MetroBody => {
  const out = structuredClone(body);
  edit(out);
  return out;
};

describe("undoMetroChange", () => {
  it("round trips: each change undone on b gives the inverse line", () => {
    const { a, b } = metroPair();
    const changes = metroChangesOf(diffMetro(a, b));
    expect(changes).toHaveLength(26);
    for (const c of changes) {
      const key = metroChangeKey(c);
      // These two tracks left with their station. They come back with it, not alone.
      if (key in ENDS_MISSING) {
        expect(refusal(b, a, b, key), key).toEqual([ENDS_MISSING[key]]);
        continue;
      }
      const back = keysOf(b, undoMetroChange(b, a, b, c));
      const extra = CASCADES[key] ?? [];
      expect(back, key).toEqual([inverseKey(c), ...extra].sort());
    }
  });

  it("brings back the older value: a rename, a change, the shape name", () => {
    const { a, b } = metroPair();
    const out = (key: string) => undoMetroChange(b, a, b, change(key));
    expect(out("name").name).toBe("Metro shape");
    expect(out("line:nurture:renamed").lines.find((l) => l.id === "nurture")?.label).toBe(
      "Nurture",
    );
    // Undoing the rename leaves the change of the same line.
    const social = out("line:social:renamed").lines.find((l) => l.id === "social");
    expect(social).toMatchObject({ label: "Social", entry: { via: "organic", channel: "tiktok" } });
    // Undoing the change leaves the new label.
    const changed = out("line:social:changed").lines.find((l) => l.id === "social");
    expect(changed).toMatchObject({
      label: "Socials",
      entry: { via: "organic", channel: "youtube" },
    });
    expect(out("station:prep:changed").stations.find((s) => s.id === "prep")?.idleDays).toBe(
      undefined,
    );
    expect(out("track:book_to_wait:changed").tracks.find((t) => t.id === "book_to_wait")).toEqual(
      a.tracks.find((t) => t.id === "book_to_wait"),
    );
    expect(out("frame:keep:changed").frames.find((f) => f.id === "keep")?.stations).toEqual([
      "pitch_a",
    ]);
    expect(
      out("group:onboarding:changed").groups.find((g) => g.id === "onboarding")?.stations,
    ).toEqual(["onboard"]);
  });

  it("brings back a removed item whole", () => {
    const { a, b } = metroPair();
    const out = (key: string) => undoMetroChange(b, a, b, change(key));
    expect(out("line:spare:removed").lines.find((l) => l.id === "spare")).toEqual(
      a.lines.find((l) => l.id === "spare"),
    );
    expect(out("track:pay_to_done:removed").tracks.find((t) => t.id === "pay_to_done")).toEqual(
      a.tracks.find((t) => t.id === "pay_to_done"),
    );
    expect(out("group:closing:removed").groups.find((g) => g.id === "closing")).toEqual(
      a.groups.find((g) => g.id === "closing"),
    );
    expect(out("frame:stop:removed").frames.find((f) => f.id === "stop")).toEqual(
      a.frames.find((f) => f.id === "stop"),
    );
  });

  it("takes an added line away alone", () => {
    const { a, b } = metroPair();
    const out = undoMetroChange(b, a, b, change("line:extra:added"));
    expect(out.lines.map((l) => l.id)).not.toContain("extra");
    expect(out.stations).toEqual(b.stations);
    expect(out.tracks).toEqual(b.tracks);
  });

  describe("a removed station", () => {
    it("comes back with every track of a that touches it and whose other end is in newest", () => {
      const { a, b } = metroPair();
      const out = undoMetroChange(b, a, b, change("station:docs:removed"));
      expect(out.stations.find((s) => s.id === "docs")).toEqual(
        a.stations.find((s) => s.id === "docs"),
      );
      expect(out.tracks.map((t) => t.id)).toEqual([
        ...b.tracks.map((t) => t.id),
        "fork_to_docs",
        "docs_to_merge",
      ]);
    });

    it("leaves a track out when its other end is gone", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "merge");
        x.tracks = x.tracks.filter((t) => t.from !== "merge" && t.to !== "merge");
      });
      const out = undoMetroChange(newest, a, b, change("station:docs:removed"));
      expect(out.tracks.map((t) => t.id)).toContain("fork_to_docs");
      expect(out.tracks.map((t) => t.id)).not.toContain("docs_to_merge");
    });

    it("leaves a track out when its id is already taken", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.tracks.push({
          id: "fork_to_docs",
          from: "fork",
          to: "prep",
          line: "growth",
          by: "system",
        });
      });
      const out = undoMetroChange(newest, a, b, change("station:docs:removed"));
      expect(out.tracks.filter((t) => t.id === "fork_to_docs")).toHaveLength(1);
      expect(out.tracks.find((t) => t.id === "fork_to_docs")?.to).toBe("prep");
      expect(out.tracks.map((t) => t.id)).toContain("docs_to_merge");
    });

    it("goes back into its old group when that group still exists", () => {
      const a = metroShape();
      const b = edited(a, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "signed");
        x.tracks = x.tracks.filter((t) => t.from !== "signed" && t.to !== "signed");
        x.groups = x.groups.map((g) => ({ ...g, stations: ["proposal"] }));
      });
      const out = undoMetroChange(b, a, b, change("station:signed:removed"));
      expect(out.groups.find((g) => g.id === "closing")?.stations).toEqual(["proposal", "signed"]);
      expect(out.tracks.map((t) => t.id)).toEqual(
        expect.arrayContaining(["proposal_to_signed", "signed_to_shared"]),
      );
    });

    it("goes back to its old place in the group", () => {
      const a = edited(metroShape(), (x) => {
        x.groups = [
          {
            id: "closing",
            label: "Closing",
            line: "growth",
            stations: ["review", "proposal", "signed"],
          },
        ];
      });
      const b = edited(a, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "proposal");
        x.tracks = x.tracks.filter((t) => t.from !== "proposal" && t.to !== "proposal");
        x.groups = [
          { id: "closing", label: "Closing", line: "growth", stations: ["review", "signed"] },
        ];
      });
      const out = undoMetroChange(b, a, b, change("station:proposal:removed"));
      expect(out.groups[0]?.stations).toEqual(["review", "proposal", "signed"]);
    });

    it("does not join a group that is gone", () => {
      const a = metroShape();
      const b = edited(a, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "signed");
        x.tracks = x.tracks.filter((t) => t.from !== "signed" && t.to !== "signed");
        x.groups = [];
      });
      const out = undoMetroChange(b, a, b, change("station:signed:removed"));
      expect(out.groups).toEqual([]);
    });
  });

  describe("an added station", () => {
    it("takes its tracks, its place in a group and in a frame with it", () => {
      const a = metroShape();
      const b = edited(a, (x) => {
        x.stations.push({
          id: "fresh",
          label: "Fresh",
          kind: "att",
          line: "growth",
          column: "sales",
          action: "other",
        });
        x.tracks.push({
          id: "fresh_to_review",
          from: "fresh",
          to: "review",
          line: "growth",
          by: "system",
        });
        x.groups.push({ id: "extra", label: "Extra", line: "growth", stations: ["fresh", "prep"] });
        x.frames.push({
          id: "wide",
          stations: ["fresh", "pitch_a"],
          trigger: { trigger: "trigger.reply" },
          exit: "gone",
        });
      });
      const out = undoMetroChange(b, a, b, change("station:fresh:added"));
      expect(out.stations.map((s) => s.id)).not.toContain("fresh");
      expect(out.tracks.map((t) => t.id)).not.toContain("fresh_to_review");
      expect(out.groups.find((g) => g.id === "extra")?.stations).toEqual(["prep"]);
      expect(out.frames.find((f) => f.id === "wide")?.stations).toEqual(["pitch_a"]);
    });

    it("takes a group or a frame left empty, and a frame that exits there", () => {
      const a = metroShape();
      const b = edited(a, (x) => {
        x.stations.push({ id: "fresh", label: "Fresh", kind: "exit", column: "money" });
        x.groups.push({ id: "solo", label: "Solo", line: "growth", stations: ["fresh"] });
        x.frames.push(
          { id: "solo", stations: ["fresh"], trigger: { trigger: "trigger.reply" }, exit: "done" },
          {
            id: "toward",
            stations: ["pitch_a"],
            trigger: { trigger: "trigger.reply" },
            exit: "fresh",
          },
        );
      });
      const out = undoMetroChange(b, a, b, change("station:fresh:added"));
      expect(out.groups.map((g) => g.id)).toEqual(["closing"]);
      expect(out.frames.map((f) => f.id)).toEqual(["stop"]);
    });
  });

  describe("refusals", () => {
    it("refuses a change that is not a line of the diff", () => {
      const { a, b } = metroPair();
      for (const key of [
        "station:ghost:added",
        "station:prep:renamed",
        "line:growth:renamed",
        "frame:stop:changed",
      ]) {
        expect(refusal(b, a, b, key), key).toEqual(["That change is not between these versions."]);
      }
    });

    it("refuses when the shape name changed again", () => {
      const { a, b } = metroPair();
      expect(refusal({ ...b, name: "Third" }, a, b, "name")).toEqual([
        "The shape is now called Third, not Newer name. Undo the later change first.",
      ]);
    });

    it("refuses a rename or a change that was made again", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        const s = (id: string) =>
          x.stations.find((y) => y.id === id) as MetroBody["stations"][number];
        s("book").label = "Reserve";
        s("prep").idleDays = 4;
        (x.tracks.find((t) => t.id === "book_to_wait") as MetroBody["tracks"][number]).by =
          "system";
        (x.groups.find((g) => g.id === "onboarding") as MetroBody["groups"][number]).stations = [
          "onboard",
        ];
        (x.frames.find((f) => f.id === "keep") as MetroBody["frames"][number]).exit = "gone";
      });
      expect(refusal(newest, a, b, "station:book:renamed")).toEqual([
        "Station Booking is now called Reserve. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "station:prep:changed")).toEqual([
        "Station Prep was changed again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "track:book_to_wait:changed")).toEqual([
        "Track Reserve to Shows up? was changed again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "group:onboarding:changed")).toEqual([
        "Group Onboarding was changed again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "frame:keep:changed")).toEqual([
        "Frame keep was changed again. Undo the later change first.",
      ]);
    });

    it("refuses a rename, a change or an add when the item is gone", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.stations = x.stations.filter((s) => !["book", "prep", "fresh"].includes(s.id));
        x.tracks = x.tracks.filter((t) => !["book_to_wait", "fresh_to_review"].includes(t.id));
      });
      expect(refusal(newest, a, b, "station:book:renamed")).toEqual([
        "Station Booking is not in the shape any more.",
      ]);
      expect(refusal(newest, a, b, "station:prep:changed")).toEqual([
        "Station Prep is not in the shape any more.",
      ]);
      expect(refusal(newest, a, b, "station:fresh:added")).toEqual([
        "Station Fresh is not in the shape any more.",
      ]);
      expect(refusal(newest, a, b, "track:book_to_wait:changed")).toEqual([
        "Track Booking to Shows up? is not in the shape any more.",
      ]);
    });

    it("refuses an added track that was changed again", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        (x.tracks.find((t) => t.id === "reply_to_book") as MetroBody["tracks"][number]).by =
          "person";
      });
      expect(refusal(newest, a, b, "track:reply_to_book:added")).toEqual([
        "Track Reply to us to Booking was changed again. Undo the later change first.",
      ]);
    });

    it("refuses a removed item that is back, so its id is taken", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.stations.push(a.stations.find((s) => s.id === "docs") as MetroBody["stations"][number]);
        x.tracks.push(a.tracks.find((t) => t.id === "pay_to_done") as MetroBody["tracks"][number]);
        x.lines.push(a.lines.find((l) => l.id === "spare") as MetroBody["lines"][number]);
        x.groups.push(a.groups.find((g) => g.id === "closing") as MetroBody["groups"][number]);
        x.frames.push(a.frames.find((f) => f.id === "stop") as MetroBody["frames"][number]);
      });
      expect(refusal(newest, a, b, "station:docs:removed")).toEqual([
        "Station Docs is in the shape again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "track:pay_to_done:removed")).toEqual([
        "Track Pay to Done is in the shape again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "line:spare:removed")).toEqual([
        "Line Spare is in the shape again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "group:closing:removed")).toEqual([
        "Group Closing is in the shape again. Undo the later change first.",
      ]);
      expect(refusal(newest, a, b, "frame:stop:removed")).toEqual([
        "Frame Stop on reply is in the shape again. Undo the later change first.",
      ]);
    });

    it("refuses a removed item when something it points at is gone", () => {
      const { a, b } = metroPair();
      const noDone = edited(b, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "done");
      });
      expect(refusal(noDone, a, b, "track:pay_to_done:removed")).toEqual([
        "Track Pay to Done needs station Done, which is not in the shape.",
      ]);
      const noGrowth = edited(b, (x) => {
        x.lines = x.lines.filter((l) => l.id !== "growth");
      });
      expect(refusal(noGrowth, a, b, "station:docs:removed")).toEqual([
        "Station Docs needs line Growth, which is not in the shape.",
      ]);
      expect(refusal(noGrowth, a, b, "group:closing:removed")).toEqual([
        "Group Closing needs line Growth, which is not in the shape.",
      ]);
      const noGone = edited(b, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "gone");
      });
      expect(refusal(noGone, a, b, "frame:stop:removed")).toEqual([
        "Frame Stop on reply needs station No show, which is not in the shape.",
      ]);
      const noSigned = edited(b, (x) => {
        x.stations = x.stations.filter((s) => s.id !== "signed");
      });
      expect(refusal(noSigned, a, b, "group:closing:removed")).toEqual([
        "Group Closing needs station Signed, which is not in the shape.",
      ]);
    });

    it("says every missing end, not just the first", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.stations = x.stations.filter((s) => !["pay", "done"].includes(s.id));
      });
      expect(refusal(newest, a, b, "track:pay_to_done:removed")).toEqual([
        "Track Pay to Done needs station Pay, which is not in the shape.",
        "Track Pay to Done needs station Done, which is not in the shape.",
      ]);
    });

    it("refuses to take a line that still holds something", () => {
      const { a, b } = metroPair();
      const newest = edited(b, (x) => {
        x.stations.push({
          id: "late",
          label: "Late",
          kind: "exit",
          line: "extra",
          column: "money",
        });
        x.groups.push({ id: "xg", label: "Xg", line: "extra", stations: ["late"] });
        x.tracks.push(
          { id: "late_in", from: "prep", to: "late", line: "extra", by: "system" },
          {
            id: "hub_to_late",
            from: "hub",
            to: "late",
            line: "growth",
            by: "system",
            entries: ["extra"],
          },
        );
      });
      expect(refusal(newest, a, b, "line:extra:added")).toEqual([
        "Line Extra still holds station Late. Undo the later change first.",
        "Line Extra still holds track Prep to Late. Undo the later change first.",
        "Line Extra still holds track First touch to Late, which names it in entries. Undo the later change first.",
        "Line Extra still holds group Xg. Undo the later change first.",
      ]);
    });
  });

  it("never changes its inputs, whether it works or refuses", () => {
    const { a, b } = metroPair();
    const newest = edited(b, (x) => {
      x.name = "Third";
    });
    const before = canonicalJson([newest, a, b]);
    for (const base of [b, newest]) {
      for (const c of metroChangesOf(diffMetro(a, b))) {
        try {
          undoMetroChange(base, a, b, c);
        } catch {
          // A refusal is fine here; the inputs must still be whole.
        }
        expect(canonicalJson([newest, a, b]), metroChangeKey(c)).toBe(before);
      }
    }
  });

  it("gives a new body, not one that shares a list with newest", () => {
    const { a, b } = metroPair();
    const out = undoMetroChange(b, a, b, change("station:prep:changed"));
    expect(out).not.toBe(b);
    expect(out.stations).not.toBe(b.stations);
    expect(out.tracks).toBe(b.tracks);
  });
});

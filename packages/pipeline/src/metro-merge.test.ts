import { describe, expect, it } from "vitest";
import { metroShape, wideShape } from "../test/fixtures.js";
import { metroOf } from "./convert.js";
import { canonicalJson } from "./diff.js";
import type { Attach, MetroBody } from "./metro.js";
import { conflictLine, mergeMetro } from "./metro-merge.js";
import { applyOps, parseOps } from "./metro-ops.js";

const json = (b: unknown): string => canonicalJson(b);

/** A value that must be there. */
function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("missing");
  return x;
}

/** The body after the ops (written as a client writes them). */
const ed = (body: MetroBody, ...ops: unknown[]): MetroBody => applyOps(body, parseOps(ops));

const set = (on: string, id: string, field: string, value: unknown) => ({
  op: "set",
  on,
  id,
  field,
  value,
});

const base = metroShape();
const station = (b: MetroBody, id: string) => b.stations.find((s) => s.id === id);
const track = (b: MetroBody, id: string) => b.tracks.find((t) => t.id === id);
const group = (b: MetroBody, id: string) => b.groups.find((g) => g.id === id);

/** The body with the attach list of one station replaced. */
const withAttach = (body: MetroBody, id: string, attach: Attach[]): MetroBody => ({
  ...body,
  stations: body.stations.map((s) => (s.id === id ? { ...s, attach } : s)),
});

const NEW_STATION = (id: string, label = "New") => ({
  id,
  label,
  kind: "att",
  line: "growth",
  column: "sales",
  action: "other",
});

describe("mergeMetro: items", () => {
  it("merges different stations and tracks", () => {
    const live = ed(base, set("station", "reply", "idleDays", 9), {
      op: "remove",
      on: "track",
      id: "renew",
    });
    const draft = ed(
      base,
      { op: "rename", on: "station", id: "book", label: "Book a call" },
      {
        op: "add",
        on: "track",
        item: { id: "prep_to_docs", from: "prep", to: "docs", line: "growth", by: "system" },
      },
    );
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(station(body, "reply")?.idleDays).toBe(9);
    expect(station(body, "book")?.label).toBe("Book a call");
    expect(track(body, "renew")).toBeUndefined();
    expect(track(body, "prep_to_docs")).toBeDefined();
    expect(body.model).toBe("metro");
  });

  it("merges two fields of one station, one from each side", () => {
    const live = ed(base, set("station", "reply", "idleDays", 9));
    const draft = ed(base, set("station", "reply", "research", "deep"));
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(station(body, "reply")).toMatchObject({ idleDays: 9, research: "deep" });
  });

  it("merges a field set on one side and removed on the other item field", () => {
    const live = ed(base, set("station", "reply", "idleDays", null));
    const draft = ed(base, set("station", "reply", "research", "deep"));
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(station(body, "reply")).not.toHaveProperty("idleDays");
    expect(station(body, "reply")?.research).toBe("deep");
  });

  it("makes a conflict of one field changed to two values, with all three values", () => {
    const live = ed(base, set("station", "reply", "idleDays", 9));
    const draft = ed(base, set("station", "reply", "idleDays", 11));
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([
      { key: "station:reply:changed", field: "idleDays", base: 7, live: 9, draft: 11 },
    ]);
    // The merged body holds live's value.
    expect(station(body, "reply")?.idleDays).toBe(9);
    expect(conflictLine(must(conflicts[0]), [live, draft, base])).toBe(
      "Station Reply: idleDays is 9 on live and 11 in the draft (was 7).",
    );
  });

  it("is no conflict when both sides made the same change", () => {
    const both = ed(base, set("station", "reply", "idleDays", 9));
    const { body, conflicts } = mergeMetro(base, both, both);
    expect(conflicts).toEqual([]);
    expect(json(body)).toBe(json(both));
  });

  it("says a field set on one side and unset on the other is a conflict with a missing value", () => {
    const live = ed(base, set("station", "reply", "idleDays", null));
    const draft = ed(base, set("station", "reply", "idleDays", 11));
    const { conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([
      { key: "station:reply:changed", field: "idleDays", base: 7, live: undefined, draft: 11 },
    ]);
    expect(conflictLine(must(conflicts[0]), [live, draft, base])).toBe(
      "Station Reply: idleDays is not set on live and 11 in the draft (was 7).",
    );
  });

  it("names a label clash as a rename", () => {
    const live = ed(base, { op: "rename", on: "station", id: "reply", label: "Answer" });
    const draft = ed(base, { op: "rename", on: "station", id: "reply", label: "Respond" });
    const { conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ key: "station:reply:renamed", field: "label" });
  });

  it("makes a conflict of an item removed on one side and changed on the other", () => {
    const removed = ed(base, { op: "remove", on: "track", id: "renew" });
    const changed = ed(base, set("track", "renew", "label", "after 60 days"));

    const a = mergeMetro(base, removed, changed);
    expect(a.conflicts).toEqual([
      {
        key: "track:renew:changed",
        base: track(base, "renew"),
        live: undefined,
        draft: track(changed, "renew"),
      },
    ]);
    expect(conflictLine(must(a.conflicts[0]), [removed, changed, base])).toBe(
      "Track Retainer to Retain start: removed on live, changed in the draft.",
    );
    expect(track(a.body, "renew")).toBeUndefined();

    const b = mergeMetro(base, changed, removed);
    expect(b.conflicts).toEqual([
      {
        key: "track:renew:changed",
        base: track(base, "renew"),
        live: track(changed, "renew"),
        draft: undefined,
      },
    ]);
    expect(conflictLine(must(b.conflicts[0]), [changed, removed, base])).toBe(
      "Track Retainer to Retain start: changed on live, removed in the draft.",
    );
    expect(track(b.body, "renew")?.label).toBe("after 60 days");
  });

  it("takes a removal that the other side did not touch", () => {
    const removed = ed(base, { op: "remove", on: "track", id: "renew" });
    expect(track(mergeMetro(base, removed, base).body, "renew")).toBeUndefined();
    expect(track(mergeMetro(base, base, removed).body, "renew")).toBeUndefined();
  });

  it("merges an item added on both sides: equal is one, different goes field by field", () => {
    const same = ed(base, { op: "add", on: "station", item: NEW_STATION("fresh") });
    const merged = mergeMetro(base, same, same);
    expect(merged.conflicts).toEqual([]);
    expect(merged.body.stations.filter((s) => s.id === "fresh")).toHaveLength(1);

    const other = ed(base, {
      op: "add",
      on: "station",
      item: { ...NEW_STATION("fresh", "Other"), idleDays: 3 },
    });
    const { body, conflicts } = mergeMetro(base, same, other);
    expect(conflicts).toEqual([
      {
        key: "station:fresh:renamed",
        field: "label",
        base: undefined,
        live: "New",
        draft: "Other",
      },
    ]);
    expect(station(body, "fresh")).toMatchObject({ label: "New", idleDays: 3 });
    expect(conflictLine(must(conflicts[0]), [same, other])).toBe(
      'Station New: label is "New" on live and "Other" in the draft (was not set).',
    );
  });
});

describe("mergeMetro: members", () => {
  it("merges a group's stations by member", () => {
    const live = ed(base, { op: "move", on: "station", id: "prep", group: "closing" });
    const draft = ed(base, { op: "move", on: "station", id: "docs", group: "closing" });
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(group(body, "closing")?.stations).toEqual(["proposal", "signed", "prep", "docs"]);

    const gone = ed(base, { op: "move", on: "station", id: "signed", group: null });
    const mixed = mergeMetro(base, gone, draft);
    expect(mixed.conflicts).toEqual([]);
    expect(group(mixed.body, "closing")?.stations).toEqual(["proposal", "docs"]);
  });

  it("merges a track's entries by member", () => {
    const live = ed(
      base,
      set("track", "hub_to_reply", "entries", ["social", "cold", "list", "team"]),
    );
    const draft = ed(base, set("track", "hub_to_reply", "entries", ["cold", "list"]));
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(track(body, "hub_to_reply")?.entries).toEqual(["cold", "list", "team"]);
  });

  it("merges an attach list by kind and ref", () => {
    const live = ed(base, {
      op: "attach",
      on: "station",
      id: "reply",
      ref: { kind: "doc", ref: "d1" },
    });
    const draft = ed(
      base,
      { op: "attach", on: "station", id: "reply", ref: { kind: "note", ref: "n1" } },
      { op: "detach", on: "station", id: "reply", ref: "book-first/opener" },
    );
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(station(body, "reply")?.attach?.map((a) => a.ref)).toEqual(["reply-funnel", "d1", "n1"]);
  });

  it("makes a conflict of the same attach changed on both sides", () => {
    const label = (text: string) =>
      withAttach(base, "reply", [
        { kind: "template", ref: "book-first/opener" },
        { kind: "funnel", ref: "reply-funnel", label: text },
      ]);
    const { body, conflicts } = mergeMetro(base, label("Live label"), label("Draft label"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ key: "station:reply:changed", field: "attach" });
    expect(station(body, "reply")?.attach?.[1]?.label).toBe("Live label");
    expect(conflictLine(must(conflicts[0]), [body])).toBe(
      "Station Reply: attach is (changed) on live and (changed) in the draft (was (changed)).",
    );
  });

  it("drops an attach list that ends empty", () => {
    const live = ed(base, { op: "detach", on: "station", id: "reply", ref: "reply-funnel" });
    const draft = ed(base, { op: "detach", on: "station", id: "reply", ref: "book-first/opener" });
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(station(body, "reply")).not.toHaveProperty("attach");
  });
});

describe("mergeMetro: name, frames and flows", () => {
  it("merges the name by the same rule as a field", () => {
    const renamed = ed(base, { op: "rename", on: "shape", name: "Live name" });
    expect(mergeMetro(base, renamed, base).body.name).toBe("Live name");
    expect(mergeMetro(base, base, renamed).body.name).toBe("Live name");
    expect(mergeMetro(base, renamed, renamed).conflicts).toEqual([]);

    const draft = ed(base, { op: "rename", on: "shape", name: "Draft name" });
    const { body, conflicts } = mergeMetro(base, renamed, draft);
    expect(conflicts).toEqual([
      { key: "name", base: "Metro shape", live: "Live name", draft: "Draft name" },
    ]);
    expect(body.name).toBe("Live name");
    expect(conflictLine(must(conflicts[0]), [renamed])).toBe(
      'Shape name: "Live name" on live and "Draft name" in the draft (was "Metro shape").',
    );
  });

  it("keeps frames and flows, and merges changes to them", () => {
    const live: MetroBody = {
      ...base,
      flows: (base.flows ?? []).map((f) => ({ ...f, label: "Live follow-up" })),
    };
    const draft: MetroBody = {
      ...base,
      frames: base.frames.map((f) => ({ ...f, label: "Draft stop" })),
    };
    const { body, conflicts } = mergeMetro(base, live, draft);
    expect(conflicts).toEqual([]);
    expect(body.frames[0]?.label).toBe("Draft stop");
    expect(body.flows?.[0]?.label).toBe("Live follow-up");
    expect(body.flows?.[0]?.stations).toHaveLength(2);
    expect(json(mergeMetro(base, base, base).body)).toBe(json(base));
  });

  it("merges the stations of a flow by member, and a frame's stations by member", () => {
    const flowStation = (id: string) => ({
      id,
      label: id,
      kind: "att" as const,
      line: "growth",
      column: "delivery" as const,
      action: "email" as const,
    });
    const addTo = (b: MetroBody, id: string): MetroBody => ({
      ...b,
      flows: (b.flows ?? []).map((f) => ({ ...f, stations: [...f.stations, flowStation(id)] })),
    });
    const { body, conflicts } = mergeMetro(base, addTo(base, "n1"), addTo(base, "n2"));
    expect(conflicts).toEqual([]);
    expect(body.flows?.[0]?.stations.map((s) => s.id)).toEqual(["nudge", "check_in", "n1", "n2"]);

    const frame = (b: MetroBody, stations: string[]): MetroBody => ({
      ...b,
      frames: b.frames.map((f) => ({ ...f, stations })),
    });
    const frames = mergeMetro(
      base,
      frame(base, ["pitch_a", "pitch_b", "prep"]),
      frame(base, ["pitch_b"]),
    );
    expect(frames.conflicts).toEqual([]);
    expect(frames.body.frames[0]?.stations).toEqual(["pitch_b", "prep"]);
  });

  it("makes a conflict when one flow is changed on both sides", () => {
    const label = (text: string): MetroBody => ({
      ...base,
      flows: (base.flows ?? []).map((f) => ({ ...f, label: text })),
    });
    const { conflicts } = mergeMetro(base, label("A"), label("B"));
    expect(conflicts).toEqual([
      {
        key: "flow:shared_followup:renamed",
        field: "label",
        base: "Follow-up flow",
        live: "A",
        draft: "B",
      },
    ]);
  });

  it("gives a body with no flows key no flows key", () => {
    const r = metroOf(wideShape());
    if (!r.ok) throw new Error(r.errors.join(" "));
    const view = r.body;
    expect("flows" in view).toBe(false);
    expect("flows" in mergeMetro(view, view, view).body).toBe(false);
  });
});

describe("mergeMetro: order", () => {
  it("puts live's items first, then the draft's added items", () => {
    const live = ed(base, { op: "add", on: "station", item: NEW_STATION("live_new") });
    const draft = ed(base, { op: "add", on: "station", item: NEW_STATION("draft_new") });
    const ids = mergeMetro(base, live, draft).body.stations.map((s) => s.id);
    expect(ids.slice(-2)).toEqual(["live_new", "draft_new"]);
    expect(ids.slice(0, -2)).toEqual(base.stations.map((s) => s.id));
  });

  it("keeps a line move of the draft when live did not reorder", () => {
    const live = ed(base, {
      op: "add",
      on: "line",
      item: { id: "extra", label: "Extra", tier: "front" },
    });
    const draft = ed(base, { op: "move", on: "line", id: "retain", before: "social" });
    const ids = mergeMetro(base, live, draft).body.lines.map((l) => l.id);
    expect(ids).toEqual(["retain", "social", "cold", "list", "team", "nurture", "growth", "extra"]);
  });

  it("keeps a line move of live when the draft did not reorder", () => {
    const live = ed(base, { op: "move", on: "line", id: "retain", before: "social" });
    const draft = ed(base, {
      op: "add",
      on: "line",
      item: { id: "extra", label: "E", tier: "front" },
    });
    const ids = mergeMetro(base, live, draft).body.lines.map((l) => l.id);
    expect(ids).toEqual(["retain", "social", "cold", "list", "team", "nurture", "growth", "extra"]);
  });

  it("lets live win when both sides reorder", () => {
    const live = ed(base, { op: "move", on: "line", id: "retain", before: "social" });
    const draft = ed(base, { op: "move", on: "line", id: "growth", before: "social" });
    const ids = mergeMetro(base, live, draft).body.lines.map((l) => l.id);
    expect(ids[0]).toBe("retain");
  });

  it("returns the conflicts in a fixed order", () => {
    const edit = (n: number, name: string): MetroBody =>
      ed(
        base,
        { op: "rename", on: "shape", name },
        set("track", "renew", "cond", `c${n}`),
        set("station", "reply", "idleDays", n),
        set("station", "reply", "research", n === 1 ? "deep" : "full"),
        set("station", "book", "retries", n),
        set("line", "growth", "colour", n + 3),
      );
    const { conflicts } = mergeMetro(base, edit(1, "One"), edit(2, "Two"));
    expect(conflicts.map((c) => `${c.key} ${c.field ?? ""}`.trim())).toEqual([
      "name",
      "line:growth:changed colour",
      "station:book:changed retries",
      "station:reply:changed idleDays",
      "station:reply:changed research",
      "track:renew:changed cond",
    ]);
  });
});

describe("mergeMetro: identities and inputs", () => {
  const view = (() => {
    const r = metroOf(wideShape());
    if (!r.ok) throw new Error(r.errors.join(" "));
    return r.body;
  })();

  const edits = (b: MetroBody): MetroBody[] => {
    const first = b.stations.find((s) => s.kind === "att");
    return [
      b,
      ed(b, { op: "rename", on: "shape", name: "Edited" }),
      ed(b, {
        op: "move",
        on: "line",
        id: must(b.lines.at(-1)).id,
        before: must(b.lines[0]).id,
      }),
      ed(b, { op: "remove", on: "station", id: must(first).id }),
      ed(b, { op: "add", on: "line", item: { id: "extra", label: "Extra", tier: "front" } }),
      ed(b, set("station", must(first).id, "idleDays", 4)),
    ];
  };

  it.each([
    ["the metro fixture", base],
    ["a drawn graph", view],
  ])("mergeMetro(b, b, d) is d and mergeMetro(b, l, b) is l: %s", (_, b) => {
    for (const x of edits(b)) {
      const forward = mergeMetro(b, b, x);
      expect(forward.conflicts).toEqual([]);
      expect(json(forward.body)).toBe(json(x));
      const back = mergeMetro(b, x, b);
      expect(back.conflicts).toEqual([]);
      expect(json(back.body)).toBe(json(x));
      // Order too, not only content.
      expect(back.body.stations.map((s) => s.id)).toEqual(x.stations.map((s) => s.id));
      expect(forward.body.lines.map((l) => l.id)).toEqual(x.lines.map((l) => l.id));
    }
  });

  it("does not change its inputs", () => {
    const b = metroShape();
    const l = ed(b, set("station", "reply", "idleDays", 9), {
      op: "remove",
      on: "track",
      id: "renew",
    });
    const d = ed(b, set("station", "reply", "idleDays", 11), set("track", "renew", "cond", "x"));
    const frozen = [json(b), json(l), json(d)];
    mergeMetro(b, l, d);
    expect([json(b), json(l), json(d)]).toEqual(frozen);
  });

  it("is the same whichever way the same edits are merged when they are disjoint", () => {
    const a = ed(base, set("station", "reply", "idleDays", 9));
    const b = ed(base, set("station", "book", "retries", 5));
    expect(json(mergeMetro(base, a, b).body)).toBe(json(mergeMetro(base, b, a).body));
  });
});

describe("conflictLine", () => {
  it("prints a long value as (changed)", () => {
    const long = "x".repeat(61);
    const live = ed(base, set("track", "renew", "cond", long));
    const draft = ed(base, set("track", "renew", "cond", "short"));
    const { conflicts } = mergeMetro(base, live, draft);
    expect(conflictLine(must(conflicts[0]), [live, draft, base])).toBe(
      'Track Retainer to Retain start: cond is (changed) on live and "short" in the draft (was not set).',
    );
  });

  it("prints a value of 60 characters as it is", () => {
    const edge = "y".repeat(58);
    const live = ed(base, set("track", "renew", "cond", edge));
    const draft = ed(base, set("track", "renew", "cond", "z"));
    const { conflicts } = mergeMetro(base, live, draft);
    expect(conflictLine(must(conflicts[0]), [live])).toContain(`"${edge}" on live`);
  });
});

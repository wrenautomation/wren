import type { FieldMeta, RecordMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import { totalSays, widthOf } from "./fields.js";
import { actionKeys, fitColumns, fitOf, shownColumns, titleLeast, widthsOf } from "./records.js";

const field = (key: string, kind: FieldMeta["kind"] = "text"): FieldMeta => ({
  key,
  kind,
  label: key,
  ops: [],
  sortable: false,
  searchable: false,
  column: { align: "start", width: "m", max: 280 },
});
const name = field("name");
const state = field("state", "status");
const note = field("note");
const city = field("city");
const meta = {
  id: "test.thing",
  app: "test",
  channel: null,
  name: { one: "thing", many: "things" },
  title: "name",
  subtitle: null,
  fields: [name, state, note, city],
  views: [],
  related: [],
  actions: [],
  activity: false,
  detail: true,
} satisfies RecordMeta;
const cols = [name, state, note, city];
const rows = [
  { id: 1, name: "Alpha", state: "open", note: null, city: "Springfield" },
  { id: 2, name: "Beta", state: "done", note: "", city: null },
];

describe("shownColumns", () => {
  it("drops a column blank on every row", () => {
    expect(shownColumns(meta, cols, rows, { byHand: false, narrow: false })).toEqual([
      name,
      state,
      city,
    ]);
  });
  it("drops a column that mostly repeats the title", () => {
    const text = field("text");
    const drafts = [
      { id: 1, name: "Before a candidate", text: "Before a candidate takes a counter" },
      { id: 2, name: "Most placements", text: "Most placements fall through" },
    ];
    expect(shownColumns(meta, [name, text], drafts, { byHand: false, narrow: false })).toEqual([
      name,
    ]);
    // A Reddit post's own title on one row of three still leaves the column out.
    const titled = [...drafts, { id: 3, name: "How we vet", text: "A video on vetting" }];
    expect(shownColumns(meta, [name, text], titled, { byHand: false, narrow: false })).toEqual([
      name,
    ]);
    const own = [...titled, { id: 4, name: "Reactivation", text: "Old clients know you" }];
    expect(
      shownColumns(meta, [name, text], own.slice(1), { byHand: false, narrow: false }),
    ).toEqual([name, text]);
  });
  it("keeps every column picked by hand, and every column with no rows", () => {
    expect(shownColumns(meta, cols, rows, { byHand: true, narrow: false })).toEqual(cols);
    expect(shownColumns(meta, cols, [], { byHand: false, narrow: false })).toEqual(cols);
  });
  it("on a phone shows the title, the state that tells the rows apart, then the next fields", () => {
    expect(shownColumns(meta, cols, rows, { byHand: false, narrow: true })).toEqual([
      name,
      state,
      city,
    ]);
    const kind = field("kind", "status");
    const same = rows.map((r) => ({ ...r, kind: "post" }));
    expect(shownColumns(meta, [name, kind, state], same, { byHand: false, narrow: true })).toEqual([
      name,
      state,
    ]);
  });
  it("on a phone puts the wait a page watches first after the state", () => {
    const seen = field("seen", "date");
    const dated = rows.map((r) => ({ ...r, seen: "2026-10-13" }));
    expect(
      shownColumns(meta, [name, state, city, seen], dated, {
        byHand: false,
        narrow: true,
        wait: "seen",
      }),
    ).toEqual([name, state, seen, city]);
  });
});

describe("fitOf", () => {
  it("fits a column to its head and widest cell, up to its kind's max", () => {
    const kind = field("kind", "status");
    expect(fitOf(kind, [{ id: 1, kind: "post" }])).toBeLessThan(widthOf(kind));
    expect(fitOf(note, [{ id: 1, note: "x".repeat(80) }])).toBe(280);
    expect(fitOf(note, [])).toBe(widthOf(note));
  });
  it("sizes a firm by its name, and a state by its label and dot", () => {
    const firm = field("company", "company");
    const firms = [{ id: 1, company: { name: "Northwind Dental Partners", domain: null } }];
    // 25 characters at 7.2px and the padding: wider than the 144px preset, so never cut.
    expect(fitOf(firm, firms)).toBeGreaterThanOrEqual(25 * 7.2 + 24);
    const status = {
      ...field("status", "status"),
      states: { upcoming: { label: "Upcoming", tone: "warn" } },
    } as FieldMeta;
    expect(fitOf(status, [{ id: 1, status: "upcoming" }])).toBeGreaterThanOrEqual(10 * 7.2 + 24);
  });
  it("leaves a choice room for its platform mark", () => {
    const site = {
      ...field("site", "choice"),
      states: { facebook: { label: "Facebook", tone: "neutral", mark: "facebook" } },
    } as FieldMeta;
    const plain = {
      ...field("site", "choice"),
      states: { facebook: { label: "Facebook", tone: "neutral" } },
    } as FieldMeta;
    const rows = [{ id: 1, site: "facebook" }];
    expect(fitOf(site, rows) - fitOf(plain, rows)).toBeGreaterThanOrEqual(20);
  });
  it("leaves a score room for its bar", () => {
    const score = { ...field("score", "score"), max: 100 } as FieldMeta;
    const bare = { ...field("n", "score"), label: "score" };
    const rows = [{ id: 1, score: 123456789, n: 123456789 }];
    expect(fitOf(score, rows) - fitOf(bare, rows)).toBeGreaterThanOrEqual(7 * 7.2);
    // Its widest figure, 100, shows whole: 40px bar, 8px gap, three digits (about 8.1px each) and the padding.
    expect(fitOf(score, [{ id: 1, score: 100 }])).toBeGreaterThanOrEqual(40 + 8 + 3 * 8.1 + 24);
  });
});

describe("totalSays", () => {
  it("leaves out what the rows already show", () => {
    expect(totalSays(note, { n: 5, of: 5 })).toBe(false);
    expect(totalSays(note, { n: 0, of: 5 })).toBe(false);
    expect(totalSays(state, { most: "open", n: 5, of: 5 })).toBe(false);
    expect(totalSays(state, { most: "open", n: 3, of: 5 })).toBe(false);
    expect(totalSays(field("at", "date"), { newest: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(totalSays(note, { n: 3, of: 5 })).toBe(false);
  });
  it("keeps sums and rates", () => {
    expect(totalSays(field("cost", "money"), { sum: 10, currency: "USD" })).toBe(true);
    expect(totalSays(field("reply", "rate"), { n: 1, of: 9 })).toBe(true);
  });
});

describe("actionKeys", () => {
  const send: Action = {
    id: "send",
    label: "Send",
    handler: "x/send",
    key: "a",
    when: { type: ["email"] },
  };
  const dm: Action = {
    id: "dm",
    label: "DM them",
    handler: "x/dm",
    key: "m",
    when: { type: ["comment"] },
  };
  const reply: Action = { ...dm, id: "reply", label: "Reply", key: "a" };
  it("names only keys that work on a row shown", () => {
    expect(actionKeys([send, dm], [{ id: 1, type: "email" }])).toEqual([["A", "Send"]]);
  });
  it("one key, two actions: both said", () => {
    const rows = [
      { id: 1, type: "email" },
      { id: 2, type: "comment" },
    ];
    expect(actionKeys([send, reply], rows)).toEqual([["A", "Send or reply"]]);
  });
});

describe("widthsOf", () => {
  it("gives a call's firm and state their words, and the rest to Who", () => {
    const who = { ...field("who", "name"), label: "Who" };
    const firm = { ...field("company", "company"), label: "Company" };
    const status = {
      ...field("status", "status"),
      label: "Status",
      column: { align: "start", width: "s", max: 200 },
      states: {
        upcoming: { label: "Upcoming", tone: "warn" },
        past: { label: "Say how it went", tone: "neutral" },
      },
    } as FieldMeta;
    const calls = { ...meta, title: "who", fields: [who, firm, status] };
    const rows = [
      { id: 1, who: "Dana Whitfield", company: { name: "Northwind Dental", domain: null } },
      { id: 2, who: "Sam Ortiz", company: { name: "Harbor Roofing Co", domain: null } },
    ].map((r) => ({ ...r, status: "upcoming" }));
    const w = widthsOf(calls, [who, firm, status], rows);
    expect(w.who).toBeUndefined();
    expect(w.company).toBeGreaterThanOrEqual(17 * 7.2 + 24);
    expect(w.status).toBeGreaterThanOrEqual(10 * 7.2 + 24);
    // A state's column fits the widest label it may show, so no state is ever cut.
    expect(w.status).toBeLessThanOrEqual(widthOf(status));
  });
  it("before the room is known: each column its words on one line, up to its max", () => {
    const firm = field("company", "company");
    const rows = [
      { id: 1, name: "Al", company: { name: "z".repeat(60), domain: null }, note: "x".repeat(80) },
    ];
    const w = widthsOf(meta, [name, firm, note], rows);
    expect(w.name).toBeUndefined();
    expect(w.company).toBe(280);
    expect(w.note).toBe(280);
  });
  it("narrows a figure to its two-line head and its values", () => {
    const days = {
      ...field("days", "number"),
      label: "Days pending",
      column: { align: "end", width: "s", max: 160 },
    } as FieldMeta;
    const size = { ...field("size"), label: "People" };
    const rows = [{ id: 1, name: "Al", days: 12, size: "1001" }];
    const w = widthsOf(meta, [name, days, size], rows);
    // "pending" at the head's 12.5px, its icon, and the padding: well under the 108px preset.
    expect(w.days).toBeLessThan(100);
    expect(w.size).toBeLessThan(100);
  });
});

describe("widthsOf in a room", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const long = Array.from({ length: 3 }, (_, i) => ({
    id: i,
    name: "Status update for the campaign that went out on the first",
    state: "open",
    note: words(12),
    city: words(10),
  }));
  const used = (w: Record<string, number | undefined>, title: number) =>
    cols.reduce((n, f) => n + (w[f.key] ?? title), 72);
  it("gives a wide room to every column's words on one line, and the rest to the title", () => {
    const fit = widthsOf(meta, cols, long, 4000);
    expect(fit.name).toBeUndefined();
    expect(fit.note).toBeGreaterThan(280);
    expect(used(fit, titleLeast(meta, long))).toBeLessThanOrEqual(4000);
  });
  it("wraps word columns to fit, never a state, so the last column stays on screen", () => {
    const fit = widthsOf(meta, cols, long, 700);
    expect(fit.state).toBe(widthsOf(meta, cols, long).state);
    expect(fit.note).toBeLessThan(280);
    expect(fit.city).toBeLessThan(280);
    expect(used(fit, titleLeast(meta, long))).toBeLessThanOrEqual(700);
  });
  it("fills a column of short words before a long one grows", () => {
    const table = field("table");
    const rows = long.map((r) => ({ ...r, table: "Company event checks" }));
    const all = [name, table, note, city];
    const whole = widthsOf(meta, all, rows).table;
    expect(widthsOf(meta, all, rows, 800).table).toBe(whole);
  });
  it("never breaks a word: at the least, the list is wider than the room", () => {
    const fit = widthsOf(meta, cols, long, 200);
    expect(fit.note).toBe(fitOf(note, [{ id: 1, note: "word10" }]));
    expect(used(fit, titleLeast(meta, long))).toBeGreaterThan(200);
  });
  it("keeps a name's longest word whole", () => {
    const who = { ...field("who", "name"), label: "Who" };
    const people = { ...meta, title: "who", fields: [who, note] };
    const rows = [{ id: 1, who: "Maximiliana Featherstonehaugh-Montgomery", note: "x" }];
    // "Featherstonehaugh-" at the title's 7.6px, the avatar and the padding.
    expect(titleLeast(people, rows)).toBeGreaterThanOrEqual(Math.ceil(18 * 7.6) + 24 + 30);
    expect(titleLeast(people, [{ id: 1, who: "Bo Fenwick", note: "x" }])).toBe(160);
  });
});

describe("fitColumns", () => {
  const rows = [{ id: 1, name: "Ada North", state: "open", note: "a few words", city: "Lisbon" }];
  const at = (room?: number) => fitColumns(meta, cols, rows, room).map((f) => f.key);
  it("shows every column before the room is known, or when they fit", () => {
    expect(at()).toEqual(["name", "state", "note", "city"]);
    expect(at(4000)).toEqual(["name", "state", "note", "city"]);
  });
  it("leaves out what the room can't hold whole, in order, never the title", () => {
    const shown = at(330);
    expect(shown[0]).toBe("name");
    expect(shown.length).toBeLessThan(4);
    const w = widthsOf(
      meta,
      cols.filter((f) => shown.includes(f.key)),
      rows,
      330,
    );
    const sum = Object.values(w).reduce<number>(
      (n, x) => n + (x ?? 0),
      72 + titleLeast(meta, rows),
    );
    expect(sum).toBeLessThanOrEqual(330);
    expect(at(10)).toEqual(["name"]);
  });
});

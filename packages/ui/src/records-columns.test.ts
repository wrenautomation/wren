import type { FieldMeta, RecordMeta } from "@wren/core/records";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import { totalSays, widthOf } from "./fields.js";
import { fitOf, fitRoom, KeyHints, shownColumns, widthsOf } from "./records.js";

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
  it("drops a column that only repeats the title", () => {
    const text = field("text");
    const drafts = [
      { id: 1, name: "Before a candidate", text: "Before a candidate takes a counter" },
      { id: 2, name: "Most placements", text: "Most placements fall through" },
    ];
    expect(shownColumns(meta, [name, text], drafts, { byHand: false, narrow: false })).toEqual([
      name,
    ]);
    const titled = [...drafts, { id: 3, name: "How we vet", text: "A video on vetting" }];
    expect(shownColumns(meta, [name, text], titled, { byHand: false, narrow: false })).toEqual([
      name,
      text,
    ]);
  });
  it("keeps every column picked by hand, and every column with no rows", () => {
    expect(shownColumns(meta, cols, rows, { byHand: true, narrow: false })).toEqual(cols);
    expect(shownColumns(meta, cols, [], { byHand: false, narrow: false })).toEqual(cols);
  });
  it("on a phone shows the title and the first state that tells the rows apart", () => {
    expect(shownColumns(meta, cols, rows, { byHand: false, narrow: true })).toEqual([name, state]);
    const kind = field("kind", "status");
    const same = rows.map((r) => ({ ...r, kind: "post" }));
    expect(shownColumns(meta, [name, kind, state], same, { byHand: false, narrow: true })).toEqual([
      name,
      state,
    ]);
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
  it("leaves a score room for its bar", () => {
    const score = { ...field("score", "score"), max: 100 } as FieldMeta;
    const bare = { ...field("n", "score"), label: "score" };
    const rows = [{ id: 1, score: 123456789, n: 123456789 }];
    expect(fitOf(score, rows) - fitOf(bare, rows)).toBeGreaterThanOrEqual(7 * 7.2);
  });
});

describe("totalSays", () => {
  it("leaves out what the rows already show", () => {
    expect(totalSays(note, { n: 5, of: 5 })).toBe(false);
    expect(totalSays(note, { n: 0, of: 5 })).toBe(false);
    expect(totalSays(state, { most: "open", n: 5, of: 5 })).toBe(false);
    expect(totalSays(state, { most: "open", n: 3, of: 5 })).toBe(false);
    expect(totalSays(field("at", "date"), { newest: "2026-01-01T00:00:00Z" })).toBe(false);
  });
  it("keeps sums, rates and partly empty text", () => {
    expect(totalSays(field("cost", "money"), { sum: 10, currency: "USD" })).toBe(true);
    expect(totalSays(field("reply", "rate"), { n: 1, of: 9 })).toBe(true);
    expect(totalSays(note, { n: 3, of: 5 })).toBe(true);
  });
});

describe("KeyHints", () => {
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
  const hints = (rows: { id: number; type: string }[]) =>
    renderToStaticMarkup(createElement(KeyHints, { actions: [send, dm], row: undefined, rows }));
  it("with no row picked, names only keys that work on a row shown", () => {
    const posts = hints([{ id: 1, type: "email" }]);
    expect(posts).toContain("send");
    expect(posts).not.toContain("dm them");
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
  it("lets a firm's long name share the spare room with a long reason", () => {
    const firm = field("company", "company");
    const rows = [
      { id: 1, name: "Al", company: { name: "z".repeat(60), domain: null }, note: "x".repeat(80) },
    ];
    const w = widthsOf(meta, [name, firm, note], rows);
    expect(w.name).toBeGreaterThan(0);
    expect(w.company).toBeUndefined();
    expect(w.note).toBeUndefined();
  });
  it("lets the title take the room, unless it is short and a text column is cut", () => {
    const long = [{ id: 1, name: "Alpha", note: "x".repeat(80), city: "Springfield" }];
    const short = widthsOf(meta, [name, note, city], long);
    expect(short.name).toBeGreaterThan(0);
    expect(short.note).toBeUndefined();
    const wide = [{ id: 1, name: "y".repeat(120), note: "x".repeat(80), city: "Springfield" }];
    const titled = widthsOf(meta, [name, note, city], wide);
    expect(titled.name).toBeUndefined();
    expect(titled.note).toBe(280);
  });
});

describe("fitRoom", () => {
  const long = Array.from({ length: 3 }, (_, i) => ({
    id: i,
    name: "Status update for the campaign that went out on the first",
    state: "open",
    note: "x".repeat(60),
    city: "y".repeat(60),
  }));
  it("leaves widths alone when they fit", () => {
    const widths = widthsOf(meta, cols, long);
    expect(fitRoom(meta, cols, widths, 4000)).toEqual(widths);
  });
  it("cuts word columns, never a state, so the last column stays on screen", () => {
    const widths = widthsOf(meta, cols, long);
    const fit = widthsOf(meta, cols, long, 900);
    expect(fit.state).toBe(widths.state);
    expect(fit.note).toBeLessThan(widths.note ?? 0);
    expect(fit.city).toBeLessThan(widths.city ?? 0);
    const used = cols.reduce((n, f) => n + (fit[f.key] ?? 220), 72);
    expect(used).toBeLessThanOrEqual(900);
  });
  it("keeps a column of short values whole while a long one can give", () => {
    const table = field("table");
    const rows = long.map((r) => ({ ...r, table: "Company event checks" }));
    const all = [name, table, note, city];
    const widths = widthsOf(meta, all, rows);
    const fit = widthsOf(meta, all, rows, 900);
    expect(fit.table).toBe(widths.table);
    expect(fit.note).toBeLessThan(widths.note ?? 0);
  });
  it("gives the title's slack before a column of short values cuts", () => {
    const table = field("table");
    const rows = long.map((r) => ({ ...r, table: "Company event checks" }));
    const all = [name, table, note, city];
    const widths = widthsOf(meta, all, rows);
    // Long ones at their head (96 each) and the title at its least still leave the table whole.
    const room = 72 + 96 * 2 + (widths.table ?? 0) + 160;
    expect(widthsOf(meta, all, rows, room).table).toBe(widths.table);
    expect(widthsOf(meta, all, rows, room - 40).table).toBeLessThan(widths.table ?? 0);
  });
  it("grows a cut word column into spare room before the title takes it", () => {
    const short = long.map((r) => ({ ...r, note: "z".repeat(50), city: "Springfield" }));
    const widths = widthsOf(meta, cols, short);
    const fit = widthsOf(meta, cols, short, 4000);
    expect(widths.note).toBe(280);
    expect(fit.note).toBeGreaterThanOrEqual(50 * 7.2 + 24);
    expect(fit.city).toBe(widths.city);
  });
  it("stops at each column's head", () => {
    const fit = widthsOf(meta, cols, long, 200);
    expect(fit.note).toBe(96);
  });
});

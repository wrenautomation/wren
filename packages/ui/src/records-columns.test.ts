import type { FieldMeta, RecordMeta } from "@wren/core/records";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Action } from "./action.js";
import { totalSays, widthOf } from "./fields.js";
import { fitOf, KeyHints, shownColumns } from "./records.js";

const field = (key: string, kind: FieldMeta["kind"] = "text"): FieldMeta => ({
  key,
  kind,
  label: key,
  ops: [],
  sortable: false,
  searchable: false,
  column: { align: "start", width: "m" },
});
const name = field("name");
const state = field("state", "status");
const note = field("note");
const city = field("city");
const meta = {
  id: "test.thing",
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
  it("fits a column to its head and widest cell, up to its preset", () => {
    const kind = field("kind", "status");
    expect(fitOf(kind, [{ id: 1, kind: "post" }])).toBeLessThan(widthOf(kind));
    expect(fitOf(note, [{ id: 1, note: "x".repeat(80) }])).toBe(widthOf(note));
    expect(fitOf(note, [])).toBe(widthOf(note));
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

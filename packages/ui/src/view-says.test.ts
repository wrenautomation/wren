/** The words a tab, pill or chip says on hover: read from `where` and `sort`, or its `hint`. */
import type { FieldMeta, SavedView } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import {
  orList,
  sayFilter,
  sayFilters,
  sayRaw,
  saySaved,
  saySort,
  sayView,
  sayWhere,
  sortTip,
} from "./view-says.js";

const field = (over: Partial<FieldMeta>): FieldMeta => ({
  key: "f",
  kind: "text",
  label: "F",
  ops: [],
  sortable: true,
  searchable: false,
  column: null,
  ...over,
});
const type = field({
  key: "type",
  kind: "status",
  label: "Type",
  ops: ["eq", "in"],
  states: {
    comment: { label: "Comment", tone: "neutral" },
    dm: { label: "DM", tone: "neutral" },
    thread: { label: "Thread", tone: "neutral" },
  },
});
const state = field({
  key: "state",
  kind: "status",
  label: "State",
  ops: ["eq", "in"],
  states: { waiting: { label: "Waiting on you", tone: "warn" } },
});
const at = field({ key: "at", kind: "date", label: "Received", ops: ["gte", "lte", "empty"] });
const score = field({ key: "score", kind: "score", label: "Fit", ops: ["gte", "lte"] });
const name = field({ key: "name", label: "Name", ops: ["contains", "empty"] });
const meta = {
  fields: [type, state, at, score, name],
  name: { one: "item", many: "items" },
  views: [{ id: "waiting", label: "Waiting on you", where: { state: "waiting" } }],
};
const view = (over: Partial<SavedView>): SavedView => ({ id: "v", label: "V", ...over });
const day = new Date(2026, 9, 14);

describe("orList", () => {
  it("joins in plain words", () => {
    expect(orList([])).toBe("");
    expect(orList(["a"])).toBe("a");
    expect(orList(["a", "b"])).toBe("a or b");
    expect(orList(["a", "b", "c"])).toBe("a, b or c");
  });
});

describe("sayFilter", () => {
  it("reads state keys as their labels", () => {
    expect(sayFilter(type, "type", "dm")).toBe("Type: DM");
    expect(sayFilter(type, "type", ["comment", "dm"])).toBe("Type: Comment or DM");
    expect(sayFilter(type, "type", { in: ["comment", "dm", "thread"] })).toBe(
      "Type: Comment, DM or Thread",
    );
  });
  it("reads ranges, words and empties", () => {
    expect(sayFilter(score, "score", { gte: 1000 }, day)).toBe("Fit: at least 1,000");
    expect(sayFilter(score, "score", { gte: 5, lte: 9 }, day)).toBe("Fit: between 5 and 9");
    expect(sayFilter(at, "at", { gte: new Date(2026, 9, 1).toISOString() }, day)).toBe(
      "Received: from Oct 1",
    );
    expect(sayFilter(at, "at", { lte: new Date(2025, 11, 31).toISOString() }, day)).toBe(
      "Received: until Dec 31, 2025",
    );
    expect(sayFilter(name, "name", { contains: "acme" })).toBe("Name: has “acme”");
    expect(sayFilter(name, "name", { empty: true })).toBe("Name: empty");
    expect(sayFilter(name, "name", { empty: false })).toBe("Name: has a value");
  });
  it("falls back to the key when the field is unknown", () => {
    expect(sayFilter(undefined, "gone", "x")).toBe("gone: x");
  });
});

describe("sayRaw", () => {
  it("reads the address form, a preset by its name", () => {
    expect(sayRaw(type, "comment,dm")).toBe("Type: Comment or DM");
    expect(sayRaw(at, "7d")).toBe("Received: last 7 days");
    expect(sayRaw(score, "10..")).toBe("Fit: at least 10");
    expect(sayRaw(name, "~acme")).toBe("Name: has “acme”");
  });
});

describe("saySort", () => {
  it("says the direction as the field's kind reads it", () => {
    expect(saySort(meta, "-at")).toBe("Sort: Received, newest first");
    expect(saySort(meta, "at")).toBe("Sort: Received, oldest first");
    expect(saySort(meta, "-score")).toBe("Sort: Fit, highest first");
    expect(saySort(meta, "name")).toBe("Sort: Name, A to Z");
    expect(saySort(meta, undefined)).toBeNull();
  });
});

describe("sayView", () => {
  it("reads filters and sort", () => {
    expect(sayView(meta, view({ where: { type: ["comment", "dm"] }, sort: "-at" }))).toBe(
      "Type: Comment or DM · Sort: Received, newest first",
    );
    expect(sayView(meta, view({ where: { state: "waiting", type: "dm" } }))).toBe(
      "Type: DM · State: Waiting on you",
    );
  });
  it("says everything for a view that keeps nothing, and yours for a mine view", () => {
    expect(sayView(meta, view({}))).toBe("All items");
    expect(sayView(meta, view({ mine: "owner", sort: "-at" }))).toBe(
      "Only yours · Sort: Received, newest first",
    );
  });
  it("a hint wins", () => {
    expect(sayView(meta, view({ where: { type: "dm" }, hint: "People writing to us." }))).toBe(
      "People writing to us.",
    );
  });
});

describe("sayWhere", () => {
  it("lists fields in the record's order, unknown ones last", () => {
    expect(sayWhere(meta, { state: "waiting", type: "dm", odd: "x" })).toEqual([
      "Type: DM",
      "State: Waiting on you",
      "odd: x",
    ]);
  });
});

describe("saySaved", () => {
  it("reads what a saved view's address keeps", () => {
    expect(saySaved(meta, "view=waiting&type=comment,dm&q=acme&sort=-at&cols=a,b", day)).toBe(
      "From the Waiting on you tab · Type: Comment or DM · Search: “acme” · Sort: Received, newest first",
    );
  });
  it("says so when it keeps nothing", () => {
    expect(saySaved(meta, "", day)).toBe("Every item in the tab");
  });
});

describe("sayFilters", () => {
  it("lists the filters on now, or what Filter is for", () => {
    const fields = [type, state, name];
    expect(sayFilters(new URLSearchParams("type=dm&state=waiting"), fields, day)).toBe(
      "Type: DM · State: Waiting on you",
    );
    expect(sayFilters(new URLSearchParams("q=x"), fields, day)).toBe(
      "Narrow the list by any field",
    );
  });
});

describe("sortTip", () => {
  const seen = { key: "seen", label: "Seen", kind: "date" } as const;
  const name = { key: "name", label: "Name", kind: "text" } as const;
  it("says what a click does when the column is not the sort", () => {
    expect(sortTip(seen, undefined, "-seen")).toBe("Sort by Seen, newest first");
    expect(sortTip(name, "-seen", "name")).toBe("Sort by Name, A to Z");
  });
  it("says how it runs now and what the next click turns it to", () => {
    expect(sortTip(seen, "-seen", "seen")).toBe("Sorted newest first. Click for oldest first.");
    expect(sortTip(name, "name", "-name")).toBe("Sorted A to Z. Click for Z to A.");
  });
});

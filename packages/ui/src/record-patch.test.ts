import { describe, expect, it } from "vitest";
import { recordPatch } from "./record-patch.js";

const detail = {
  record: "posts",
  row: { id: 7, text: "old", state: "draft" },
  edit: { values: { title: "A" }, version: "v-1", history: [], asks: [] },
};
const list = {
  record: "posts",
  rows: [
    { id: 7, text: "old" },
    { id: 8, text: "other" },
  ],
};

describe("record write-through", () => {
  it("patches the row in its detail and its lists, and moves the version", () => {
    const line = { id: 3, by: "You" };
    const p = recordPatch(
      "posts",
      "7",
      { text: "new", title: "B" },
      { version: "v-2", change: line },
    );
    expect(p("posts:7:0", detail)).toEqual({
      ...detail,
      row: { id: 7, text: "new", title: "B", state: "draft" },
      edit: { ...detail.edit, values: { title: "B" }, version: "v-2", history: [line] },
    });
    expect(p("list", list)).toEqual({
      record: "posts",
      rows: [
        { id: 7, text: "new", title: "B" },
        { id: 8, text: "other" },
      ],
    });
  });

  it("leaves other records and other answers the same object", () => {
    const p = recordPatch("posts", 9, { text: "new" });
    expect(p("posts:7:0", detail)).toBe(detail);
    expect(p("list", list)).toBe(list);
    const people = { ...detail, record: "people" };
    expect(recordPatch("posts", 7, { text: "new" })("x", people)).toBe(people);
    expect(recordPatch("posts", 7, { text: "new" })("types", [1, 2])).toEqual([1, 2]);
  });
});

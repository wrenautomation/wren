import { describe, expect, it } from "vitest";
import { detailPatch, recordPatch, twinRecord } from "./record-patch.js";

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

twinRecord("t.draft", (id, f) => ({
  record: "t.approval",
  id: `draft:${id}`,
  fields: "text" in f ? { body: f.text, version: f.version } : {},
}));

describe("recordPatch twins", () => {
  it("patches the same row in its twin's list", () => {
    const p = recordPatch("t.draft", "3", { text: "new", version: "v2" });
    const list = { record: "t.approval", rows: [{ id: "draft:3", body: "old", version: "v1" }] };
    expect(p("k", list)).toEqual({
      record: "t.approval",
      rows: [{ id: "draft:3", body: "new", version: "v2" }],
    });
    const own = { record: "t.draft", rows: [{ id: "3", text: "old" }] };
    expect((p("k", own) as typeof own).rows[0]?.text).toBe("new");
  });
});

describe("detailPatch", () => {
  it("writes the detail and row fields of one record only", () => {
    const p = detailPatch("t.video", 5, (d) => ({
      detail: { ...(d as object), x: 2 },
      row: { title: "T" },
    }));
    const read = { record: "t.video", row: { id: 5, title: "old" }, detail: { x: 1 } };
    expect(p("k", read)).toEqual({
      record: "t.video",
      row: { id: 5, title: "T" },
      detail: { x: 2 },
    });
    const other = { record: "t.video", row: { id: 6 }, detail: { x: 1 } };
    expect(p("k", other)).toBe(other);
  });
});

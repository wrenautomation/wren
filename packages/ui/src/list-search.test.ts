import { describe, expect, it } from "vitest";
import { LIST_SEARCH, listChange, listStateOf, paramsOf, searchOf } from "./list-search.js";

const META = {
  name: { one: "person", many: "people" },
  account: "inbox",
  fields: [
    { key: "status", label: "Status", kind: "text" },
    { key: "inbox", label: "Inbox", kind: "text" },
  ],
} as never;

describe("search and params", () => {
  it("round-trip, a repeated key keeping every value", () => {
    const p = new URLSearchParams("status=open&tag=a&tag=b&q=a+b");
    expect(paramsOf(searchOf(p)).toString()).toBe(p.toString());
  });

  it("drop empty values", () => {
    expect(paramsOf({ a: "", b: null, c: undefined, d: 0 }).toString()).toBe("d=0");
  });
});

describe("LIST_SEARCH", () => {
  it("drops a value that doesn't fit and keeps the rest", () => {
    const got = LIST_SEARCH.parse({ pg: "abc", as: "grid", sort: "-at", status: "open" });
    expect(got).toEqual({ sort: "-at", status: "open" });
  });

  it("reads a page as a number", () => {
    expect(LIST_SEARCH.parse({ pg: "3" }).pg).toBe(3);
  });
});

describe("listStateOf", () => {
  it("reads filters, the account and the open record through the type", () => {
    const s = listStateOf(META, new URLSearchParams("status=open&inbox=a&person=12&group=status"));
    expect(s).toMatchObject({
      group: "status",
      open: "12",
      account: "a",
      filters: { status: "open", inbox: "a" },
    });
  });

  it("writes a change under the address's keys", () => {
    expect(listChange(META, { open: "7", account: undefined, filters: { status: null } })).toEqual({
      person: "7",
      inbox: null,
      status: null,
    });
  });
});

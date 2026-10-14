/** ⌘K's record search: rows as found lines, each opening as its own page. */
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const calls: { path: string; body: unknown }[] = [];
vi.mock("./api.js", () => ({
  call: async (path: string, body: unknown) => {
    calls.push({ path, body });
    if (path.endsWith("/recordsTypes"))
      return [{ id: "deals.deal", title: "name", subtitle: "stage" }];
    return {
      rows: [
        { id: 7, name: "Roof job", stage: { label: "Quoted" } },
        { id: 8, name: null, stage: null },
      ],
    };
  },
}));

const { findRecords } = await import("./find.js");
const { WREN } = await import("./module.js");

afterEach(() => {
  calls.length = 0;
});

describe("findRecords", () => {
  const find = findRecords({ record: "deals.deal", path: "/deals/deals", kind: "Deal" });
  it("a client's rows from its product, each with its page", async () => {
    const got = await find("roof", "c1");
    expect(got).toEqual([
      { label: "Roof job", href: "/deals/deals/7", hint: "Deal · Quoted" },
      { label: "8", href: "/deals/deals/8", hint: "Deal" },
    ]);
    expect(calls.at(-1)).toEqual({
      path: "deals/recordsList",
      body: {
        client: "c1",
        app: "deals",
        asClient: false,
        record: "deals.deal",
        q: "roof",
        limit: 5,
      },
    });
  });
  it("Wren's own from the console", async () => {
    await find("roof", WREN.id);
    expect(calls.at(-1)?.path).toBe("console/recordsList");
  });
});

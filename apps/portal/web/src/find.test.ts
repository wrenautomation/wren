/** ⌘K's record search: rows as found lines, each opening as its own page. */
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const calls: { path: string; body: unknown }[] = [];
vi.mock("./api.js", () => ({
  call: async (path: string, body: unknown) => {
    calls.push({ path, body });
    if (path.endsWith("/recordsTypes"))
      return [{ id: "pipeline.journey", title: "name", subtitle: "stage" }];
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
  const find = findRecords({
    record: "pipeline.journey",
    path: "/pipelines/journeys",
    kind: "Journey",
  });
  it("a client's rows from its product, each with its page", async () => {
    const got = await find("roof", "c1");
    expect(got).toEqual([
      { label: "Roof job", href: "/pipelines/journeys/7", hint: "Journey · Quoted" },
      { label: "8", href: "/pipelines/journeys/8", hint: "Journey" },
    ]);
    expect(calls.at(-1)).toEqual({
      path: "pipeline/recordsList",
      body: {
        client: "c1",
        app: "pipelines",
        asClient: false,
        record: "pipeline.journey",
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

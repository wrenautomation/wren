import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import { consoleApi, toCsv } from "./console.js";
import { PortalRefusal } from "./portal.js";

const rows = Object.assign([{ niche: "widgets", in_play: "12", note: 'a "b", c' }], {
  columns: [
    { name: "niche", type: 1043 },
    { name: "in_play", type: 20 },
    { name: "note", type: 25 },
  ],
});
const main = { execute: async () => rows } as unknown as Db;
const api = consoleApi({ main, views: ["pipeline_funnel"] });
const operator = { email: "op@example.test", operator: true };

const refused = async (p: Promise<unknown>, status: number) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
};

describe("ConsolePortal view", () => {
  it("refuses anyone but Wren's team", async () => {
    await refused(api.view({ viewer: { email: "amy@acme.test" }, view: "pipeline_funnel" }), 403);
    await refused(api.view({ viewer: { demo: true }, view: "pipeline_funnel" }), 403);
    await refused(api.view({ viewer: operator, asClient: true, view: "pipeline_funnel" }), 403);
  });

  it("refuses a view that isn't allowed", async () => {
    await refused(api.view({ viewer: operator, view: "person_facts" }), 404);
    await refused(api.view({ viewer: operator, view: "toString" }), 404);
  });

  it("answers columns and rows, counts as numbers", async () => {
    expect(await api.view({ viewer: operator, view: "pipeline_funnel" })).toEqual({
      view: "pipeline_funnel",
      columns: ["niche", "in_play", "note"],
      rows: [["widgets", 12, 'a "b", c']],
    });
  });

  it("answers CSV, quoting where needed", async () => {
    const csv = await api.view({ viewer: operator, view: "pipeline_funnel", format: "csv" });
    expect(csv).toEqual({
      view: "pipeline_funnel",
      csv: 'niche,in_play,note\r\nwidgets,12,"a ""b"", c"',
    });
    expect(toCsv({ columns: ["a"], rows: [[null]] })).toBe("a\r\n");
  });
});

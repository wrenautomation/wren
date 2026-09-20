import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Dataset, fetchDataset } from "./datasets.js";
import { PoliteFetcher } from "./fetcher.js";

const fakeFetch = (async (url: string | URL | Request) =>
  new Response(`body of ${String(url)}`, { status: 200 })) as unknown as typeof fetch;

describe("fetchDataset", () => {
  it("lands the newest files under <dest>/<dataset>/ and skips what is already there", async () => {
    const fetcher = new PoliteFetcher("t (t@example.com)", {
      fetch: fakeFetch,
      minInterval: 0,
      sleep: async () => {},
    });
    const dataset: Dataset = {
      name: "demo",
      description: "",
      listFiles: async (_f, limit) =>
        [
          { dataset: "demo", fileName: "b.csv", url: "https://x/b.csv", period: "2026-08" },
          { dataset: "demo", fileName: "a.csv", url: "https://x/a.csv", period: "2026-07" },
        ].slice(0, limit),
    };
    const root = mkdtempSync(join(tmpdir(), "ds-"));
    const first = await fetchDataset(fetcher, dataset, { limit: 2, destRoot: root });
    expect(first.map((f) => [f.remote.fileName, f.downloaded])).toEqual([
      ["b.csv", true],
      ["a.csv", true],
    ]);
    expect(readFileSync(join(root, "demo", "b.csv"), "utf8")).toBe("body of https://x/b.csv");
    const again = await fetchDataset(fetcher, dataset, { limit: 1, destRoot: root });
    expect(again.map((f) => [f.remote.fileName, f.downloaded])).toEqual([["b.csv", false]]);
  });
});

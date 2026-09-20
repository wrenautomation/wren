/** The SEC datasets read the publisher's catalogs and return the newest files. */
import { PoliteFetcher } from "@wren/research/fetch";
import { describe, expect, it } from "vitest";
import { SEC_DATASETS, SEC_REPORTS_BASE } from "./datasets.js";

const CATALOG = {
  advFilingData: {
    sectionDisplayName: "ADV Filing Data",
    "2026": {
      files: [
        { fileName: "ADV_Filing_Data_20260601_20260630.zip" },
        { fileName: "ADV_Filing_Data_20260701_20260731.zip" },
        { fileName: "README.txt" },
      ],
    },
    "2025": { files: [{ fileName: "ADV_Filing_Data_20251201_20251231.zip" }] },
  },
};
const MANIFEST = {
  files: [
    { name: "IA_FIRM_SEC_Feed_09_02_2026.xml.gz" },
    { name: "IA_INDVL_Feed_09_02_2026.xml.gz" },
    { name: "IA_FIRM_STATE_Feed_09_02_2026.xml.gz" },
  ],
};
const fetcher = new PoliteFetcher("t (t@example.com)", {
  minInterval: 0,
  sleep: async () => {},
  fetch: (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("reports_metadata.json")) return Response.json(CATALOG);
    if (u.endsWith("CompilationReports.manifest.json")) return Response.json(MANIFEST);
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch,
});
const dataset = (name: string) =>
  SEC_DATASETS.find((d) => d.name === name) as (typeof SEC_DATASETS)[number];

describe("SEC datasets", () => {
  it("lists a FOIA section newest first, across years, up to the limit", async () => {
    const files = await dataset("adv-filing-data").listFiles(fetcher, 2);
    expect(files.map((f) => [f.fileName, f.period])).toEqual([
      ["ADV_Filing_Data_20260701_20260731.zip", "2026-07"],
      ["ADV_Filing_Data_20260601_20260630.zip", "2026-06"],
    ]);
    expect(files[0]?.url).toBe(
      `${SEC_REPORTS_BASE}/foia/advFilingData/2026/ADV_Filing_Data_20260701_20260731.zip`,
    );
  });

  it("picks the one feed per prefix out of the manifest", async () => {
    const [feed] = await dataset("firm-feed").listFiles(fetcher, 3);
    expect(feed).toMatchObject({
      fileName: "IA_FIRM_SEC_Feed_09_02_2026.xml.gz",
      period: "2026-09-02",
      url: `${SEC_REPORTS_BASE}/CompilationReports/IA_FIRM_SEC_Feed_09_02_2026.xml.gz`,
    });
    expect(await dataset("firm-feed").listFiles(fetcher, 3)).toHaveLength(1);
  });
});

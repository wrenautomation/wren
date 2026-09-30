/** PPP loans: file links off the dataset page, and the streaming NAICS filter. No network. */
import { Readable, Writable } from "node:stream";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { FetchError, PoliteFetcher } from "./fetcher.js";
import { filterLoanCsv, PPP_DATASET_PAGE, parsePppFileLinks, pppLoans } from "./ppp.js";

const BASE = "https://data.sba.gov/dataset/8aa276e2/resource";
const PAGE = `<html><body>
<a href="${BASE}/r1/download/public_150k_plus_240930.csv">150k+</a>
<a href="${BASE}/r2/download/public_up_to_150k_1_240930.csv">up to 150k 1</a>
<a href="${BASE}/r2-mirror/download/public_up_to_150k_1_240930.csv">same file again</a>
<a href="${BASE}/r3/download/public_up_to_150k_2_240930.csv">up to 150k 2</a>
<a href="${BASE}/r0/download/public_150k_plus_230930.csv">older</a>
<a href="${BASE}/r9/download/ppp-data-dictionary.xlsx">dictionary</a>
<a href="https://example.com/public_fake_240930.csv">off site</a>
<a href="${BASE}/r8/download/Public_UPPER_240930.csv">upper case</a>
</body></html>`;

/** A Writable that keeps what it's given; a tiny buffer so drain actually happens. */
function collector() {
  const chunks: string[] = [];
  const out = new Writable({
    highWaterMark: 1,
    write(chunk, _enc, done) {
      chunks.push(String(chunk));
      setImmediate(done);
    },
  });
  return { out, text: () => chunks.join("") };
}

const filter = async (csv: string, naics = ["561320"]) => {
  const { out, text } = collector();
  const counts = await filterLoanCsv(Readable.from([csv]), out, new Set(naics));
  return {
    counts,
    text: text(),
    records: parse(text(), { relax_column_count: true }) as string[][],
  };
};

describe("parsePppFileLinks", () => {
  it("loan CSVs on data.sba.gov with their release, first link per file name", () => {
    expect(parsePppFileLinks(PAGE)).toEqual([
      {
        fileName: "public_150k_plus_240930.csv",
        url: `${BASE}/r1/download/public_150k_plus_240930.csv`,
        release: "240930",
      },
      {
        fileName: "public_up_to_150k_1_240930.csv",
        url: `${BASE}/r2/download/public_up_to_150k_1_240930.csv`,
        release: "240930",
      },
      {
        fileName: "public_up_to_150k_2_240930.csv",
        url: `${BASE}/r3/download/public_up_to_150k_2_240930.csv`,
        release: "240930",
      },
      {
        fileName: "public_150k_plus_230930.csv",
        url: `${BASE}/r0/download/public_150k_plus_230930.csv`,
        release: "230930",
      },
    ]);
  });

  it("a page with no loan links is empty", () => {
    expect(parsePppFileLinks("<html></html>")).toEqual([]);
  });
});

describe("pppLoans", () => {
  const spec = { name: "ppp-demo", description: "demo", naics: ["561320"] };
  const fetcher = (status: number, body: string) =>
    new PoliteFetcher("t (t@example.com)", {
      minInterval: 0,
      sleep: async () => {},
      fetch: (async (url: string | URL | Request) =>
        String(url) === PPP_DATASET_PAGE
          ? new Response(body, { status })
          : new Response("", { status: 404 })) as unknown as typeof fetch,
    });

  it("lists every file of the newest release only, whatever the limit", async () => {
    const files = await pppLoans(spec).listFiles(fetcher(200, PAGE), 1);
    expect(files.map((f) => [f.fileName, f.period, f.dataset])).toEqual([
      ["public_150k_plus_240930.csv", "240930", "ppp-demo"],
      ["public_up_to_150k_1_240930.csv", "240930", "ppp-demo"],
      ["public_up_to_150k_2_240930.csv", "240930", "ppp-demo"],
    ]);
    expect(files[0]?.url).toBe(`${BASE}/r1/download/public_150k_plus_240930.csv`);
  });

  it("a failed page or a page without links is a FetchError", async () => {
    await expect(pppLoans(spec).listFiles(fetcher(500, PAGE), 1)).rejects.toThrow(FetchError);
    await expect(pppLoans(spec).listFiles(fetcher(200, "<html/>"), 1)).rejects.toThrow(
      /no loan CSV links/,
    );
  });

  it.each([[["56132"]], [["5613200"]], [["x61320"]], [[]]])("bad NAICS rejected: %j", (naics) => {
    expect(() => pppLoans({ ...spec, naics })).toThrow(
      /ppp dataset ppp-demo: NAICS codes are 6 digits/,
    );
  });
});

describe("filterLoanCsv", () => {
  it("keeps the header and only the listed codes", async () => {
    const csv = [
      "LoanNumber,BorrowerName,NAICSCode,JobsReported",
      "1,Acme Staffing,561320,12",
      "2,Beta Plumbing,238220,4",
      "3,Gamma Search,561311,3",
      "4,Delta Temps,561320,40",
      "",
    ].join("\n");
    const { counts, records } = await filter(csv);
    expect(counts).toEqual({ read: 4, kept: 2 });
    expect(records).toEqual([
      ["LoanNumber", "BorrowerName", "NAICSCode", "JobsReported"],
      ["1", "Acme Staffing", "561320", "12"],
      ["4", "Delta Temps", "561320", "40"],
    ]);
  });

  it("quoted fields with commas, quotes and newlines survive the round trip", async () => {
    const csv = [
      "BorrowerName,BorrowerAddress,NAICSCode",
      '"Acme Staffing, LLC","12 ""Main"" St\nSuite 4",561320',
      '"Skip, Me","1 Road",111110',
      "",
    ].join("\r\n");
    const { counts, text, records } = await filter(csv);
    expect(counts).toEqual({ read: 2, kept: 1 });
    expect(records[1]).toEqual(["Acme Staffing, LLC", '12 "Main" St\nSuite 4', "561320"]);
    expect(text.startsWith('"BorrowerName","BorrowerAddress","NAICSCode"\n')).toBe(true);
  });

  it("a BOM before the header doesn't hide the NAICSCode column", async () => {
    const csv = "﻿NAICSCode,BorrowerName\n561320,Acme\n238220,Beta\n";
    const { counts, records } = await filter(csv);
    expect(counts).toEqual({ read: 2, kept: 1 });
    expect(records).toEqual([
      ["NAICSCode", "BorrowerName"],
      ["561320", "Acme"],
    ]);
  });

  it("whitespace around a code still matches; ragged rows don't stop the stream", async () => {
    const csv = "Name,NAICSCode,Extra\nAcme, 561320 ,x\nShort\nBeta,561311,y,z\n";
    const { counts, records } = await filter(csv, ["561320", "561311"]);
    expect(counts).toEqual({ read: 3, kept: 2 });
    expect(records.slice(1)).toEqual([
      ["Acme", "561320", "x"],
      ["Beta", "561311", "y", "z"],
    ]);
  });

  it("no NAICSCode column, or no header at all, is a FetchError", async () => {
    await expect(filter("Name,NAICS\nAcme,561320\n")).rejects.toThrow(/no NAICSCode column/);
    await expect(filter("")).rejects.toThrow(/ppp file is empty/);
    await expect(filter("")).rejects.toBeInstanceOf(FetchError);
  });

  it("a large stream through a slow writer completes (back-pressure)", async () => {
    const rows = Array.from(
      { length: 2000 },
      (_, i) => `${i},Firm ${i},${i % 2 ? "561320" : "238220"}`,
    );
    const csv = `LoanNumber,BorrowerName,NAICSCode\n${rows.join("\n")}\n`;
    const { counts, records } = await filter(csv);
    expect(counts).toEqual({ read: 2000, kept: 1000 });
    expect(records).toHaveLength(1001);
  });
});

/** Overture places: releases off the S3 listing, the COPY a download runs, the spec check. */
import { describe, expect, it } from "vitest";
import { FetchError, PoliteFetcher } from "./fetcher.js";
import {
  OVERTURE_BUCKET,
  type OverturePlacesSpec,
  overturePlaces,
  parseReleases,
  placesCopySql,
} from "./overture.js";

const LISTING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>${OVERTURE_BUCKET}</Name><Prefix>release/</Prefix><Delimiter>/</Delimiter>
  <CommonPrefixes><Prefix>release/2025-08-20.1/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>release/2025-09-24.0/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>release/2025-08-20.0/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>release/2025-07-23/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>release/latest/</Prefix></CommonPrefixes>
  <CommonPrefixes><Prefix>bridgefiles/2025-09-24.0/</Prefix></CommonPrefixes>
</ListBucketResult>`;

const spec: OverturePlacesSpec = {
  name: "overture-demo",
  description: "demo",
  categories: ["employment_agency", "temp_agency"],
  countries: ["US", "CA"],
};

const fetcherAnswering = (status: number, body: string, seen: string[] = []) =>
  new PoliteFetcher("t (t@example.com)", {
    minInterval: 0,
    sleep: async () => {},
    fetch: (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(body, { status });
    }) as unknown as typeof fetch,
  });

describe("parseReleases", () => {
  it("dated release prefixes only, newest first", () => {
    expect(parseReleases(LISTING_XML)).toEqual([
      "2025-09-24.0",
      "2025-08-20.1",
      "2025-08-20.0",
      "2025-07-23",
    ]);
  });

  it("a listing with no releases is empty", () => {
    expect(parseReleases("<ListBucketResult></ListBucketResult>")).toEqual([]);
  });
});

describe("placesCopySql", () => {
  it("filters categories, first-address country, and the countries' boxes", () => {
    const sql = placesCopySql(spec, "2025-09-24.0", "/data/places.jsonl.part");
    expect(sql).toContain(
      `read_parquet('s3://${OVERTURE_BUCKET}/release/2025-09-24.0/theme=places/type=place/*', hive_partitioning = false)`,
    );
    expect(sql).toContain("taxonomy.primary IN ('employment_agency', 'temp_agency')");
    expect(sql).toContain("addresses[1].country IN ('US', 'CA')");
    expect(sql).toContain(
      "(bbox.xmin >= -180 AND bbox.xmax <= -64 AND bbox.ymin >= 17 AND bbox.ymax <= 72)",
    );
    expect(sql).toContain(
      "(bbox.xmin >= -142 AND bbox.xmax <= -52 AND bbox.ymin >= 41 AND bbox.ymax <= 84)",
    );
    expect(sql).toContain(
      "EXCLUDE (geometry, bbox), bbox.xmin AS longitude, bbox.ymin AS latitude",
    );
    expect(sql).toMatch(/\) TO '\/data\/places\.jsonl\.part' \(FORMAT json\)$/);
    // The box clause comes first so DuckDB can skip row groups on it.
    expect(sql.indexOf("bbox.xmin >=")).toBeLessThan(sql.indexOf("taxonomy.primary"));
  });

  it("a country with no box scans the world", () => {
    const sql = placesCopySql({ ...spec, countries: ["US", "MX"] }, "2025-09-24.0", "/x.jsonl");
    expect(sql).not.toContain("bbox.xmin >=");
    expect(sql).toContain("addresses[1].country IN ('US', 'MX')");
  });

  it("quotes in the destination are doubled", () => {
    expect(placesCopySql(spec, "2025-09-24.0", "/tmp/o'brien.jsonl")).toContain(
      "TO '/tmp/o''brien.jsonl' (FORMAT json)",
    );
  });
});

describe("overturePlaces", () => {
  it("lists one file per release, newest first, up to the limit", async () => {
    const seen: string[] = [];
    const files = await overturePlaces(spec).listFiles(fetcherAnswering(200, LISTING_XML, seen), 2);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(`${OVERTURE_BUCKET}.s3.us-west-2.amazonaws.com`);
    expect(seen[0]).toContain("prefix=release/");
    expect(files).toEqual([
      {
        dataset: "overture-demo",
        fileName: "places-2025-09-24.0.jsonl",
        url: `s3://${OVERTURE_BUCKET}/release/2025-09-24.0/theme=places/type=place/*`,
        period: "2025-09-24.0",
      },
      {
        dataset: "overture-demo",
        fileName: "places-2025-08-20.1.jsonl",
        url: `s3://${OVERTURE_BUCKET}/release/2025-08-20.1/theme=places/type=place/*`,
        period: "2025-08-20.1",
      },
    ]);
  });

  it("a failed listing is a FetchError carrying the status", async () => {
    const err = await overturePlaces(spec)
      .listFiles(fetcherAnswering(403, "<Error/>"), 1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).message).toContain("HTTP 403");
  });

  it("the spec is checked before anything runs", () => {
    const bad: Partial<OverturePlacesSpec>[] = [
      { categories: ["Employment Agency"] },
      { categories: ["x'; DROP TABLE t; --"] },
      { countries: ["usa"] },
      { countries: ["us"] },
      { categories: [] },
      { countries: [] },
    ];
    for (const b of bad) expect(() => overturePlaces({ ...spec, ...b })).toThrow(/overture-demo/);
    expect(() => overturePlaces({ ...spec, categories: ["Bad Cat"] })).toThrow(/bad: Bad Cat/);
    expect(() => overturePlaces({ ...spec, countries: [] })).toThrow(/bad: empty/);
  });
});

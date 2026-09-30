/**
 * Overture Maps places as a bulk dataset. A niche names the categories
 * (`taxonomy.primary`, e.g. `employment_agency`) and the countries it sells in;
 * this reads the newest release off Overture's public S3 bucket and writes every
 * matching place as JSON lines: one place per line, every field but the geometry
 * (the bbox corner gives the point). Filtering what to import is the import
 * format's job, so the file on disk is the whole pull.
 *
 * Releases come from S3's own listing, never a guessed name. DuckDB does the read
 * (anonymous S3, row groups skipped by bbox) and is imported only when a download
 * runs: the Lambda bundle never loads the native module.
 */
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Dataset, RemoteFile } from "./datasets.js";
import { type DownloadResult, FetchError } from "./fetcher.js";

export const OVERTURE_BUCKET = "overturemaps-us-west-2";
const LISTING = `https://${OVERTURE_BUCKET}.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/`;
const RELEASE = /<Prefix>release\/(\d{4}-\d{2}-\d{2}(?:\.\d+)?)\/<\/Prefix>/g;

/** [xmin, ymin, xmax, ymax]: lets DuckDB skip row groups. A country not listed scans the world. */
const COUNTRY_BOXES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  US: [-180, 17, -64, 72],
  CA: [-142, 41, -52, 84],
};

export interface OverturePlacesSpec {
  name: string;
  description: string;
  /** Overture `taxonomy.primary` values. */
  categories: readonly string[];
  /** ISO alpha-2, matched on the place's first address. */
  countries: readonly string[];
}

/** Newest first. */
export function parseReleases(listingXml: string): string[] {
  return [...listingXml.matchAll(RELEASE)]
    .map((m) => m[1] as string)
    .sort((a, b) => b.localeCompare(a));
}

/** The COPY that writes one release's matching places to `dest`. Inputs are checked, not escaped. */
export function placesCopySql(spec: OverturePlacesSpec, release: string, dest: string): string {
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const boxes = spec.countries.map((c) => COUNTRY_BOXES[c]);
  const where = [
    `taxonomy.primary IN (${spec.categories.map(quote).join(", ")})`,
    `addresses[1].country IN (${spec.countries.map(quote).join(", ")})`,
  ];
  if (boxes.every((b) => b !== undefined)) {
    const inBox = ([x0, y0, x1, y1]: readonly number[]) =>
      `(bbox.xmin >= ${x0} AND bbox.xmax <= ${x1} AND bbox.ymin >= ${y0} AND bbox.ymax <= ${y1})`;
    where.unshift(`(${boxes.map((b) => inBox(b as readonly number[])).join(" OR ")})`);
  }
  const src = `s3://${OVERTURE_BUCKET}/release/${release}/theme=places/type=place/*`;
  return [
    "COPY (",
    "  SELECT * EXCLUDE (geometry, bbox), bbox.xmin AS longitude, bbox.ymin AS latitude",
    `  FROM read_parquet(${quote(src)}, hive_partitioning = false)`,
    `  WHERE ${where.join("\n    AND ")}`,
    `) TO ${quote(dest)} (FORMAT json)`,
  ].join("\n");
}

function checkSpec(spec: OverturePlacesSpec): void {
  const bad = [
    ...spec.categories.filter((c) => !/^[a-z0-9_]+$/.test(c)),
    ...spec.countries.filter((c) => !/^[A-Z]{2}$/.test(c)),
  ];
  if (bad.length || !spec.categories.length || !spec.countries.length)
    throw new Error(
      `overture dataset ${spec.name}: categories are snake_case, countries ISO alpha-2, neither empty (bad: ${bad.join(", ") || "empty"})`,
    );
}

/** One file per release: `places-<release>.jsonl`. `--months 1` = the newest. */
export function overturePlaces(spec: OverturePlacesSpec): Dataset {
  checkSpec(spec);
  return {
    name: spec.name,
    description: spec.description,
    listFiles: async (fetcher, limit) => {
      const resp = await fetcher.get(LISTING);
      if (resp.status !== 200)
        throw new FetchError(`overture release listing answered HTTP ${resp.status}`, resp.status);
      return parseReleases(resp.text)
        .slice(0, limit)
        .map(
          (release): RemoteFile => ({
            dataset: spec.name,
            fileName: `places-${release}.jsonl`,
            url: `s3://${OVERTURE_BUCKET}/release/${release}/theme=places/type=place/*`,
            period: release,
          }),
        );
    },
    download: async (_fetcher, remote, dest): Promise<DownloadResult> => {
      const have = await stat(dest).catch(() => null);
      if (have) return { path: dest, downloaded: false, size: have.size };
      await mkdir(dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      await unlink(part).catch(() => undefined);
      const { DuckDBInstance } = await import("@duckdb/node-api");
      const db = await DuckDBInstance.create(":memory:");
      const con = await db.connect();
      try {
        await con.run("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2';");
        await con.run(placesCopySql(spec, remote.period, part));
      } finally {
        con.closeSync();
        db.closeSync();
      }
      await rename(part, dest);
      return { path: dest, downloaded: true, size: (await stat(dest)).size };
    },
  };
}

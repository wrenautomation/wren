/**
 * The SBA's Paycheck Protection Program loan files (data.sba.gov, dataset
 * `ppp-foia`), kept to a niche's NAICS codes. Each loan names the borrower, its
 * address, jobs reported and the amount; the amount was 2.5 months of payroll, so
 * it sizes a firm no other free source does.
 *
 * The publisher's files are ~8 GB together. A download streams one file and writes
 * only the header and the niche's rows, so the kept file is a few MB. The list is
 * read off the dataset page, so a new release shows up as new file names.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { parse } from "csv-parse";
import type { Dataset, RemoteFile } from "./datasets.js";
import { type DownloadResult, FetchError } from "./fetcher.js";

export const PPP_DATASET_PAGE = "https://data.sba.gov/dataset/ppp-foia";
const FILE_LINK = /href="(https:\/\/data\.sba\.gov\/[^"]*\/(public_[a-z0-9_]+?_(\d{6})\.csv))"/g;
const TIMEOUT_MS = 60 * 60_000;

export interface PppLoansSpec {
  name: string;
  description: string;
  /** 6-digit NAICS codes a kept loan's `NAICSCode` must be one of. */
  naics: readonly string[];
}

/** The loan CSVs linked from the dataset page: file name, URL, release (yymmdd). */
export function parsePppFileLinks(
  html: string,
): { fileName: string; url: string; release: string }[] {
  const seen = new Set<string>();
  const out: { fileName: string; url: string; release: string }[] = [];
  for (const m of html.matchAll(FILE_LINK)) {
    const [, url, fileName, release] = m as unknown as [string, string, string, string];
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    out.push({ fileName, url, release });
  }
  return out;
}

const quote = (field: string) => `"${field.replace(/"/g, '""')}"`;
const csvLine = (record: string[]) => `${record.map(quote).join(",")}\n`;

/**
 * Stream a loan CSV, writing its header and the rows whose `NAICSCode` is kept.
 * Returns how many rows were read and kept.
 */
export async function filterLoanCsv(
  input: Readable,
  output: NodeJS.WritableStream,
  naics: ReadonlySet<string>,
): Promise<{ read: number; kept: number }> {
  let column = -1;
  let read = 0;
  let kept = 0;
  const write = (line: string) =>
    output.write(line)
      ? Promise.resolve()
      : new Promise<void>((r) => output.once("drain", () => r()));
  for await (const record of input.pipe(
    parse({ relax_column_count: true, relax_quotes: true, bom: true, trim: true }),
  ) as AsyncIterable<string[]>) {
    if (column < 0) {
      column = record.indexOf("NAICSCode");
      if (column < 0) throw new FetchError("ppp file has no NAICSCode column");
      await write(csvLine(record));
      continue;
    }
    read += 1;
    if (naics.has(record[column] ?? "")) {
      kept += 1;
      await write(csvLine(record));
    }
  }
  if (column < 0) throw new FetchError("ppp file is empty");
  return { read, kept };
}

/** Every loan file of the newest release, each kept to `naics`. `limit` doesn't apply: a release is all its files. */
export function pppLoans(spec: PppLoansSpec): Dataset {
  const bad = spec.naics.filter((c) => !/^\d{6}$/.test(c));
  if (bad.length || !spec.naics.length)
    throw new Error(
      `ppp dataset ${spec.name}: NAICS codes are 6 digits (bad: ${bad.join(", ") || "none given"})`,
    );
  const naics = new Set(spec.naics);
  return {
    name: spec.name,
    description: spec.description,
    listFiles: async (fetcher) => {
      const resp = await fetcher.get(PPP_DATASET_PAGE);
      if (resp.status !== 200)
        throw new FetchError(`${PPP_DATASET_PAGE} answered HTTP ${resp.status}`, resp.status);
      const links = parsePppFileLinks(resp.text);
      if (!links.length) throw new FetchError(`${PPP_DATASET_PAGE}: no loan CSV links found`);
      const newest = links
        .map((l) => l.release)
        .sort()
        .at(-1);
      return links
        .filter((l) => l.release === newest)
        .map(
          (l): RemoteFile => ({
            dataset: spec.name,
            fileName: l.fileName,
            url: l.url,
            period: l.release,
          }),
        );
    },
    download: async (fetcher, remote, dest): Promise<DownloadResult> => {
      const have = await stat(dest).catch(() => null);
      if (have) return { path: dest, downloaded: false, size: have.size };
      const resp = await fetch(remote.url, {
        headers: { "User-Agent": fetcher.userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.status !== 200 || !resp.body)
        throw new FetchError(`${remote.url} answered HTTP ${resp.status}`, resp.status);
      await mkdir(dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      await unlink(part).catch(() => undefined);
      const out = createWriteStream(part);
      try {
        await filterLoanCsv(Readable.fromWeb(resp.body as WebReadableStream), out, naics);
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
      await rename(part, dest);
      return { path: dest, downloaded: true, size: (await stat(dest)).size };
    },
  };
}

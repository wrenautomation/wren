/**
 * SBA Small Business Search (search.certifications.sba.gov) as a bulk dataset: every
 * firm that lists one of a niche's NAICS codes, one file per code per day. The body
 * is the one the site's own search page sends; the API has no paging, so one code
 * per request keeps each answer whole (the three staffing codes together passed
 * 100 MB and came back cut off).
 *
 * The file is the API's answer as is ({status, results, …}). A body that doesn't
 * parse, or has no results array, never lands: a cut-off answer would read as fewer
 * firms.
 */
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Dataset, RemoteFile } from "./datasets.js";
import { type DownloadResult, FetchError } from "./fetcher.js";

export const SBA_SEARCH_URL = "https://search.certifications.sba.gov/_api/v2/search";
const TIMEOUT_MS = 10 * 60_000;

export interface SbaSearchSpec {
  name: string;
  description: string;
  /** 6-digit NAICS codes; a firm matches when any of its codes is one of these. */
  naics: readonly string[];
}

/** The search page's filter body with everything open but one NAICS code. */
export function sbaSearchBody(naics: string): Record<string, unknown> {
  const any = { operatorType: "Or" };
  return {
    searchProfiles: { searchTerm: "" },
    location: { states: [], zipCodes: [], counties: [], districts: [], msas: [] },
    sbaCertifications: { activeCerts: [], isPreviousCert: false, ...any },
    naics: { codes: [{ value: naics, label: naics }], isPrimary: false, ...any },
    selfCertifications: { certifications: [], ...any },
    keywords: { list: [], ...any },
    lastUpdated: { date: { label: "Anytime", value: "anytime" } },
    samStatus: { isActiveSAM: false },
    qualityAssuranceStandards: { qas: [] },
    bondingLevels: {
      constructionIndividual: "",
      constructionAggregate: "",
      serviceIndividual: "",
      serviceAggregate: "",
    },
    businessSize: { relationOperator: "at-least", numberOfEmployees: "" },
    annualRevenue: { relationOperator: "at-least", annualGrossRevenue: "" },
    entityDetailId: "",
  };
}

/** Parse and check an answer; returns the result count. */
export function checkSbaAnswer(text: string, naics: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FetchError(`sba search ${naics}: answer is not whole JSON (${text.length} bytes)`);
  }
  const results = (parsed as { results?: unknown } | null)?.results;
  if (!Array.isArray(results))
    throw new FetchError(`sba search ${naics}: answer has no results array`);
  return results.length;
}

/** One file per NAICS code per day: `naics-<code>-<yyyy-mm-dd>.json`. `limit` doesn't apply. */
export function sbaSearch(spec: SbaSearchSpec, today = () => new Date()): Dataset {
  const bad = spec.naics.filter((c) => !/^\d{6}$/.test(c));
  if (bad.length || !spec.naics.length)
    throw new Error(
      `sba dataset ${spec.name}: NAICS codes are 6 digits (bad: ${bad.join(", ") || "none given"})`,
    );
  return {
    name: spec.name,
    description: spec.description,
    listFiles: async () => {
      const day = today().toISOString().slice(0, 10);
      return spec.naics.map(
        (code): RemoteFile => ({
          dataset: spec.name,
          fileName: `naics-${code}-${day}.json`,
          url: `${SBA_SEARCH_URL}#naics=${code}`,
          period: day,
        }),
      );
    },
    download: async (fetcher, remote, dest): Promise<DownloadResult> => {
      const have = await stat(dest).catch(() => null);
      if (have) return { path: dest, downloaded: false, size: have.size };
      const code = remote.url.slice(remote.url.indexOf("#naics=") + 7);
      const resp = await fetch(SBA_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": fetcher.userAgent },
        body: JSON.stringify(sbaSearchBody(code)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.status !== 200)
        throw new FetchError(`sba search ${code} answered HTTP ${resp.status}`, resp.status);
      const text = await resp.text();
      checkSbaAnswer(text, code);
      await mkdir(dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      await unlink(part).catch(() => undefined);
      await writeFile(part, text);
      await rename(part, dest);
      return { path: dest, downloaded: true, size: (await stat(dest)).size };
    },
  };
}

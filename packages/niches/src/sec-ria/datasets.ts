/**
 * SEC/IAPD bulk datasets for the RIA niche. Each reads the SEC's own catalog
 * (reports_metadata.json / CompilationReports.manifest.json; never guessed URL
 * patterns, which 403/404 as naming drifts) and returns the newest N files.
 *
 * Verified shapes (2026-09-02):
 * - reports_metadata.json: {section: {sectionDisplayName, "<year>": {files:
 *   [{fileName, size, year, …}]}}}; file URL is {BASE}/foia/{section}/{year}/{fileName}.
 * - CompilationReports.manifest.json: {files: [{name, size, date}]}; file URL is
 *   {BASE}/CompilationReports/{name}.
 */
import type { Dataset, PoliteFetcher, RemoteFile } from "@wren/research/fetch";
import { FetchError } from "@wren/research/fetch";

export const SEC_REPORTS_BASE = "https://reports.adviserinfo.sec.gov/reports";

// ADV_Filing_Data_20260701_20260731.zip -> period 2026-07
const FOIA_PERIOD = /_(\d{4})(\d{2})\d{2}_\d{8}\.zip$/;
// IA_FIRM_SEC_Feed_09_02_2026.xml.gz -> period 2026-09-02
const FEED_PERIOD = /_(\d{2})_(\d{2})_(\d{4})\.xml\.(?:gz|zip)$/;

async function fetchJson(fetcher: PoliteFetcher, url: string): Promise<unknown> {
  const resp = await fetcher.get(url);
  if (resp.status !== 200)
    throw new FetchError(`catalog ${url} answered HTTP ${resp.status}`, resp.status);
  return JSON.parse(resp.text) as unknown;
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const newestFirst = (files: RemoteFile[], limit: number) =>
  files.sort((a, b) => b.period.localeCompare(a.period)).slice(0, limit);

/** One FOIA section's monthly files, newest first. */
function foiaSection(section: string, dataset: string): Dataset["listFiles"] {
  return async (fetcher, limit) => {
    const catalog = await fetchJson(fetcher, `${SEC_REPORTS_BASE}/foia/reports_metadata.json`);
    const entries = isRecord(catalog) && isRecord(catalog[section]) ? catalog[section] : {};
    const found: RemoteFile[] = [];
    for (const [year, yearEntry] of Object.entries(entries)) {
      if (!isRecord(yearEntry)) continue; // sectionDisplayName etc.
      const files = Array.isArray(yearEntry.files) ? yearEntry.files : [];
      for (const info of files) {
        const name = isRecord(info) && typeof info.fileName === "string" ? info.fileName : "";
        const match = FOIA_PERIOD.exec(name);
        if (!match) continue;
        found.push({
          dataset,
          fileName: name,
          url: `${SEC_REPORTS_BASE}/foia/${section}/${year}/${name}`,
          period: `${match[1]}-${match[2]}`,
        });
      }
    }
    return newestFirst(found, limit);
  };
}

/** The daily compilation feeds; the manifest only lists the current day's, so one file per prefix. */
function compilationFeed(prefix: string, dataset: string): Dataset["listFiles"] {
  return async (fetcher, limit) => {
    const manifest = await fetchJson(
      fetcher,
      `${SEC_REPORTS_BASE}/CompilationReports/CompilationReports.manifest.json`,
    );
    const files = isRecord(manifest) && Array.isArray(manifest.files) ? manifest.files : [];
    const found: RemoteFile[] = [];
    for (const info of files) {
      const name = isRecord(info) && typeof info.name === "string" ? info.name : "";
      if (!name.startsWith(prefix)) continue;
      const match = FEED_PERIOD.exec(name);
      found.push({
        dataset,
        fileName: name,
        url: `${SEC_REPORTS_BASE}/CompilationReports/${name}`,
        period: match ? `${match[3]}-${match[1]}-${match[2]}` : "",
      });
    }
    return newestFirst(found, limit);
  };
}

export const SEC_DATASETS: readonly Dataset[] = [
  {
    name: "adv-filing-data",
    description: "monthly ADV filing CSVs (Schedule A owners/execs, 1J CCO names) → import-people",
    listFiles: foiaSection("advFilingData", "adv-filing-data"),
  },
  {
    name: "adv-brochures",
    description: "monthly Part 2 brochure bulk (bios, personalization material)",
    listFiles: foiaSection("advBrochures", "adv-brochures"),
  },
  {
    name: "firm-feed",
    description:
      "daily full Part 1A XML per SEC firm (all WebAddrs) → import --format sec-firm-feed",
    listFiles: compilationFeed("IA_FIRM_SEC_Feed_", "firm-feed"),
  },
  {
    name: "indvl-feed",
    description: "daily feed of every registered adviser representative",
    listFiles: compilationFeed("IA_INDVL_Feed_", "indvl-feed"),
  },
];

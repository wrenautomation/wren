/**
 * Funding (S3): SEC EDGAR full-text search for Form D filings by the firm's bare name, kept as
 * `news` with event funding. Free, no key. SEC asks for a User-Agent with a contact address (the
 * fetcher's, `wren/0.1 (<contact>)`) and at most 10 requests a second (the fetcher's per-host
 * throttle keeps it near 1). Most service firms never file, so `none` is the common answer.
 */
import { z } from "zod";
import { bareCompanyName, plain } from "../people/names.js";
import { defineCollector, firmOf, subjectOf, type Tried } from "./index.js";

export const EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index";
export const FUNDING_CONFIDENCE = 0.7;
/** SEC blocks an IP that goes over its rate for about 10 minutes; ask again after an hour. */
const CAPPED_MS = 60 * 60 * 1000;

/** One hit of the search: a document of a filing. A filing has one hit per document. */
interface EdgarHit {
  _id: string;
  _source: {
    adsh: string;
    ciks: string[];
    display_names: string[];
    file_date: string;
    form: string;
    biz_states?: string[];
    [more: string]: unknown;
  };
}

/** `Acme Partners LP  (CIK 0000000001)` → `Acme Partners LP`. */
const issuerOf = (display: string) => display.replace(/\s*\(CIK \d+\)\s*$/, "").trim();

/** The filing's index page on sec.gov. */
export const filingIndex = (cik: string, adsh: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, "")}/${adsh}-index.htm`;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const funding = defineCollector({
  name: "funding",
  subject: "company",
  built: true,
  settings: z.object({
    /** How far back to search, in months. */
    months: z.number().int().min(1).max(60).default(12),
  }),
  bucket: { perDay: 300, burst: 20 },
  everyDays: 90,
  metered: false,
  async collect(deps, subject, s) {
    const key = subjectOf(subject);
    const firm = key && "companyId" in key ? await firmOf(deps.db, key.companyId) : null;
    const tried: Tried[] = [];
    if (!firm?.name) {
      tried.push({ step: "firm", what: subject, outcome: firm ? "no name" : "no such firm" });
      return { state: "unresolved", signals: [], tried };
    }
    if (firm.country && firm.country.toUpperCase() !== "US") {
      tried.push({ step: "firm", what: subject, outcome: `not US (${firm.country})` });
      return { state: "none", signals: [], tried };
    }
    const name = bareCompanyName(firm.name);
    if (plain(name).length < 3) {
      tried.push({ step: "firm", what: firm.name, outcome: "name too short to search" });
      return { state: "unresolved", signals: [], tried };
    }
    if (!deps.fetcher) throw new Error("funding: no fetcher (WREN_FETCH_CONTACT unset)");
    const from = new Date(deps.now);
    from.setUTCMonth(from.getUTCMonth() - s.months);
    const q = new URLSearchParams({
      q: `"${name}"`,
      forms: "D",
      dateRange: "custom",
      startdt: ymd(from),
      enddt: ymd(deps.now),
    });
    const url = `${EDGAR_SEARCH}?${q}`;
    const r = await deps.fetcher.get(url);
    if (r.status === 429 || r.status === 403) {
      tried.push({ step: "sec", what: url, outcome: `HTTP ${r.status}` });
      const retryAt = new Date(deps.now.getTime() + CAPPED_MS);
      return { state: "capped", signals: [], tried, retryAt, stop: `sec HTTP ${r.status}` };
    }
    if (r.status !== 200) throw new Error(`funding: GET ${url} HTTP ${r.status}`);
    // ponytail: first page only (100 hits); a bare name with more Form Ds in a year is not a service firm.
    const hits = (JSON.parse(r.text) as { hits?: { hits?: EdgarHit[] } }).hits?.hits ?? [];
    const want = plain(name);
    const seen = new Set<string>();
    const signals = [];
    for (const h of hits) {
      const f = h._source;
      if (seen.has(f.adsh)) continue;
      seen.add(f.adsh);
      const i = f.display_names.findIndex((d) => plain(bareCompanyName(issuerOf(d))) === want);
      const cik = f.ciks[i];
      const at = new Date(`${f.file_date}T00:00:00Z`);
      if (i < 0 || !cik || Number.isNaN(at.getTime())) continue;
      signals.push({
        kind: "news" as const,
        companyId: firm.id,
        factKey: `c${firm.id}:news:sec:${f.adsh}`,
        value: {
          title: "Form D filed",
          topic: "funding",
          event: "funding",
          issuer: issuerOf(f.display_names[i] ?? ""),
          form: f.form,
          date: f.file_date,
          raw: f,
        },
        confidence: FUNDING_CONFIDENCE,
        via: "sec",
        sourceUrl: filingIndex(cik, f.adsh),
        document: null,
        signalAt: at,
        dated: "published" as const,
      });
    }
    tried.push({
      step: "sec",
      what: url,
      outcome: `${seen.size} filings, ${signals.length} match`,
    });
    return { state: signals.length ? "found" : "none", signals, tried };
  },
});

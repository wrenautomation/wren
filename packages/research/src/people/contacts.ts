/**
 * People at a company in a given line of work, from search results alone: no
 * profile is opened. A result counts when its title reads as that work and
 * the result names the firm as an employer. Whether they are there now is
 * what the result says their current employer is; someone whose result names
 * the firm as a past employer but lists another one now was there before. A
 * snippet that only mentions the firm ("placing nurses with hospitals like
 * Acme") is not employment.
 */
import type { SiteClient } from "@wren/core/content";
import { paced, realSleep } from "../pacing.js";
import { bareCompanyName, type Firm, firmNames, isFirm, mentionsFirm } from "./names.js";
import { experienceOf, linkedinProfile, readSerpTitle } from "./serp.js";

/** The people who hire: talent, recruiting, HR, people teams. */
export const HIRING_ROLES =
  /\b(talent|recruit\w*|hr|human resources|people|hiring|staffing|workforce)\b/i;
const HIRING_WORDS = ["talent", "recruiting", "human resources", "people"];
const SEARCH_HITS = 10;

export interface FoundContact {
  fullName: string;
  firstName: string;
  lastName: string;
  title: string;
  /** The employer the result lists now; null when it lists none. */
  currentCompany: string | null;
  /** Their current employer is the firm. */
  current: boolean;
  linkedin: string;
}

export interface ContactsOptions {
  max?: number;
  roles?: RegExp;
  /** Words the query ORs together; they steer the engine, `roles` decides. */
  roleWords?: string[];
  /** People who work here now are skipped: a staffing agency's own recruiters at its customer. */
  except?: Firm;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const HONORIFIC = /^(dr|mr|mrs|ms|mx|miss|prof|sir|dame)\.?$/i;
/** Suffixes and credentials, dots and dashes gone: "Jr.", "Ph.D.", "SHRM-CP". */
const SUFFIX = new Set(
  "jr sr ii iii iv mba phd md cpa pmp phr sphr shrmcp shrmscp cfa esq rn msc ms ma bsc ba cpc ccp gphr".split(
    " ",
  ),
);
/** Words that put the firm in someone's past: "formerly Acme", "ex-Acme". */
const PAST_WORDS = /\b(former|formerly|previously|ex|alum\w*|worked)\b/i;

/**
 * "Dr. Jane Doe, SHRM-CP", "Jane Doe Jr. 🚀" -> Jane / Doe. An initial for a
 * surname can't be matched later: null.
 */
export function splitName(full: string): { first: string; last: string } | null {
  const words = (full.split(",")[0] ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  while (words.length > 2 && HONORIFIC.test(words[0] ?? "")) words.shift();
  while (words.length > 2 && SUFFIX.has((words.at(-1) ?? "").toLowerCase().replace(/[.-]/g, "")))
    words.pop();
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || words.length < 2) return null;
  if (/^\p{L}\.?$/u.test(last) || !/\p{L}{2}/u.test(first)) return null;
  return { first, last };
}

/** Up to `max` people whose results say they do this work at (or did, before) the firm. */
export async function findContacts(
  sites: SiteClient,
  firm: Firm,
  opts: ContactsOptions = {},
): Promise<FoundContact[]> {
  const max = opts.max ?? 3;
  const name = bareCompanyName(firmNames(firm)[0] ?? "");
  if (!name || max <= 0) return [];
  const roles = opts.roles ?? HIRING_ROLES;
  const words = (opts.roleWords ?? HIRING_WORDS).map((w) => (w.includes(" ") ? `"${w}"` : w));
  const call = paced(sites, opts.now ?? (() => new Date()), opts.sleep ?? realSleep);
  const res = await call<{ hits: { title: string; url: string; snippet: string | null }[] }>(
    "web",
    "GET",
    "/search",
    { q: `site:linkedin.com/in "${name}" (${words.join(" OR ")})`, n: SEARCH_HITS },
  );
  const out: FoundContact[] = [];
  for (const h of res.hits) {
    const link = linkedinProfile(h.url);
    const read = link ? readSerpTitle(h.title) : null;
    if (!link || !read?.title || !roles.test(read.title)) continue;
    const parts = splitName(read.name);
    if (!parts || out.some((c) => c.linkedin === link.url)) continue;
    const currentCompany =
      experienceOf(h.snippet) ??
      read.company ??
      (read.bare && isFirm(read.bare, firm) ? read.bare : null);
    const current = !!currentCompany && isFirm(currentCompany, firm);
    if (!current && !workedThere(h, read.name, firm, roles)) continue;
    if (opts.except && currentCompany && isFirm(currentCompany, opts.except)) continue;
    out.push({
      fullName: `${parts.first} ${parts.last}`,
      firstName: parts.first,
      lastName: parts.last,
      title: read.title,
      currentCompany,
      current,
      linkedin: link.url,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The firm as an employer: in the result's title (it is about the person), or
 * in a snippet clause that puts it in their past or after their role
 * ("Talent Lead at Acme"). Clauses split on the separators engines use.
 */
function workedThere(
  hit: { title: string; snippet: string | null },
  person: string,
  firm: Firm,
  roles: RegExp,
): boolean {
  if (mentionsFirm(hit.title, firm, [person])) return true;
  const roleAt = new RegExp(`(?:${roles.source})[^,]{0,40}?\\s(?:at|@)\\s`, "i");
  return (hit.snippet ?? "")
    .split(/[.·|;\n]+/)
    .some(
      (clause) =>
        mentionsFirm(clause, firm, [person]) && (PAST_WORDS.test(clause) || roleAt.test(clause)),
    );
}

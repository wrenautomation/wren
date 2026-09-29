/**
 * People at a company in a given line of work, from search results alone: no
 * profile is opened. A result counts when its title reads as that work and
 * the result names the firm. Whether they are there now is what the result
 * says their current employer is; someone whose result names the firm but
 * lists another employer was there before.
 */
import type { SiteClient } from "@wren/core/content";
import { paced, realSleep } from "../pacing.js";
import { type Firm, firmNames, isFirm, mentionsFirm } from "./names.js";
import { experienceOf, linkedinProfile, readSerpTitle } from "./serp.js";

/** The people who hire: talent, recruiting, HR, people teams. */
export const HIRING_ROLES =
  /\b(talent|recruit\w*|hr|human resources|people (?:ops|operations|partner|team|lead|director|manager)|chief people|hiring|staffing|workforce)\b/i;
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
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** "Jane Doe, SHRM-CP" -> Jane / Doe. An initial for a surname can't be matched later: null. */
export function splitName(full: string): { first: string; last: string } | null {
  const words = (full.split(",")[0] ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
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
  const name = firmNames(firm)[0];
  if (!name) return [];
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
    const text = `${h.title}\n${h.snippet ?? ""}`;
    if (!mentionsFirm(text, firm, [read.name])) continue;
    const currentCompany =
      experienceOf(h.snippet) ??
      read.company ??
      (read.bare && isFirm(read.bare, firm) ? read.bare : null);
    out.push({
      fullName: `${parts.first} ${parts.last}`,
      firstName: parts.first,
      lastName: parts.last,
      title: read.title,
      currentCompany,
      current: !!currentCompany && isFirm(currentCompany, firm),
      linkedin: link.url,
    });
    if (out.length >= (opts.max ?? 3)) break;
  }
  return out;
}

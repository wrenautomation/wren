/**
 * People at a company in a given line of work, from a people search
 * (autobrowse `web` `/people`, Exa's index of public profiles): no profile is
 * opened. A person counts when a role they list is at the firm and reads as
 * that work. Whether they are there now is whether that role is marked
 * current; someone whose firm role ended and who lists another current one
 * left. A headline that only mentions the firm is not employment.
 */
import type { SiteClient } from "@wren/core/content";
import { paced, realSleep } from "../pacing.js";
import { bareCompanyName, type Firm, firmNames, isFirm } from "./names.js";
import { linkedinProfile } from "./serp.js";

/** The people who hire: talent, recruiting, HR, people teams. */
export const HIRING_ROLES =
  /\b(talent|recruit\w*|hr|human resources|people|hiring|staffing|workforce)\b/i;
const HIRING_WORDS = ["talent acquisition", "recruiting", "HR", "people team"];
const SEARCH_PEOPLE = 10;
const OR = new Intl.ListFormat("en", { type: "disjunction" });

/** One role as the profile lists it (autobrowse `web` `/people`). */
interface ProfileRole {
  title: string;
  company: string;
  current: boolean;
}
interface ProfilePerson {
  name: string;
  url: string;
  roles: ProfileRole[];
}

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
  /** Words the query ORs together; they steer the search, `roles` decides. */
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

/** Up to `max` people who do this work at the firm, or did before. */
export async function findContacts(
  sites: SiteClient,
  firm: Firm,
  opts: ContactsOptions = {},
): Promise<FoundContact[]> {
  const max = opts.max ?? 3;
  const name = bareCompanyName(firmNames(firm)[0] ?? "");
  if (!name || max <= 0) return [];
  const roles = opts.roles ?? HIRING_ROLES;
  const words = opts.roleWords ?? HIRING_WORDS;
  const call = paced(sites, opts.now ?? (() => new Date()), opts.sleep ?? realSleep);
  const res = await call<{ people: ProfilePerson[] }>("web", "GET", "/people", {
    q: `${OR.format(words)} people who work or worked at ${name}`,
    n: SEARCH_PEOPLE,
  });
  const out: FoundContact[] = [];
  for (const p of res.people) {
    const link = linkedinProfile(p.url);
    const parts = splitName(p.name);
    if (!link || !parts || out.some((c) => c.linkedin === link.url)) continue;
    const here = p.roles.filter((r) => isFirm(r.company, firm) && roles.test(r.title));
    // The role held now, else the latest: the title the firm's records would carry.
    const role = here.find((r) => r.current) ?? here[0];
    if (!role) continue;
    const now = p.roles.filter((r) => r.current);
    const except = opts.except;
    if (except && now.some((r) => isFirm(r.company, except))) continue;
    const nowHere = now.find((r) => isFirm(r.company, firm));
    out.push({
      fullName: `${parts.first} ${parts.last}`,
      firstName: parts.first,
      lastName: parts.last,
      title: role.title,
      currentCompany: (nowHere ?? now[0])?.company ?? null,
      current: !!nowHere,
      linkedin: link.url,
    });
    if (out.length >= max) break;
  }
  return out;
}

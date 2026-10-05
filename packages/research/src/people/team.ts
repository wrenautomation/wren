/**
 * A firm's public team from one people search (autobrowse `web` `/people`,
 * Exa's index of public profiles): the firm's name, up to 25 profiles, and
 * everyone whose current role is at the firm. No profile is opened. One call
 * per firm instead of one per person, so a hit brings most of the staff for
 * the price of one search.
 */
import type { SiteClient } from "@wren/core/content";
import { paced, realSleep } from "../pacing.js";
import { splitName } from "./contacts.js";
import { bareCompanyName, type Firm, firmNames, isFirm } from "./names.js";
import { linkedinProfile } from "./profile-link.js";

/** Profiles one search returns: the route's most, the same 7 mills as one. */
export const TEAM_SEARCH_SIZE = 25;

/** One profile as the search returns it, trimmed to what we keep. */
export interface TeamProfile {
  name: string;
  url: string;
  headline: string | null;
  roles: { title: string; company: string; current: boolean }[];
}

export interface TeamMember {
  fullName: string;
  firstName: string;
  lastName: string;
  /** The current role at the firm. */
  title: string;
  /** Canonical profile URL. */
  linkedin: string;
  vanity: string;
}

export interface TeamSearchResult {
  query: string;
  /** Every profile returned, kept or not. */
  profiles: TeamProfile[];
  members: TeamMember[];
}

/** The search words for a firm: its bare name; null when it has none worth searching. */
export function teamQuery(firm: Firm): string | null {
  const name = bareCompanyName(firmNames(firm)[0] ?? "");
  return name.length >= 3 ? name : null;
}

/**
 * The firm's people among the profiles: a full name, a profile link, and a
 * role marked current at the firm. A headline that only names the firm is
 * not a job; a past role is not someone to write to. Pure.
 */
export function keepTeam(firm: Firm, profiles: readonly TeamProfile[]): TeamMember[] {
  const out: TeamMember[] = [];
  for (const p of profiles) {
    const link = linkedinProfile(p.url);
    const parts = splitName(p.name);
    if (!link || !parts || out.some((m) => m.linkedin === link.url)) continue;
    const role = p.roles.find((r) => r.current && isFirm(r.company, firm));
    if (!role) continue;
    out.push({
      fullName: `${parts.first} ${parts.last}`,
      firstName: parts.first,
      lastName: parts.last,
      title: role.title,
      linkedin: link.url,
      vanity: link.vanity,
    });
  }
  return out;
}

interface RawProfile {
  name?: string | null;
  url?: string | null;
  headline?: string | null;
  roles?: { title?: string | null; company?: string | null; current?: boolean | null }[] | null;
}

const trim = (p: RawProfile): TeamProfile | null =>
  p.name && p.url
    ? {
        name: p.name,
        url: p.url,
        headline: p.headline ?? null,
        roles: (p.roles ?? []).map((r) => ({
          title: r.title ?? "",
          company: r.company ?? "",
          current: r.current === true,
        })),
      }
    : null;

/** One search. Throws what the site throws (`Capped` on Exa's daily cap). */
export async function searchTeam(
  sites: SiteClient,
  firm: Firm,
  opts: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TeamSearchResult | null> {
  const query = teamQuery(firm);
  if (!query) return null;
  const call = paced(sites, opts.now ?? (() => new Date()), opts.sleep ?? realSleep);
  const res = await call<{ people?: RawProfile[] }>("web", "GET", "/people", {
    q: query,
    n: TEAM_SEARCH_SIZE,
  });
  const profiles = (res.people ?? []).flatMap((p) => trim(p) ?? []);
  return { query, profiles, members: keepTeam(firm, profiles) };
}

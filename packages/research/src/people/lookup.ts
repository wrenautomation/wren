/**
 * Person lookup (R7): where is this person now? Layered, cheapest and safest
 * first, and never a guess:
 *
 * 1. The email check already run. A work mailbox that rejects mail says they
 *    probably left; one that accepts says they may still be there.
 * 2. Web search through autobrowse's `web` site, no login: a LinkedIn result
 *    whose name matches and which names the firm (or its domain) is them, and
 *    its title or description says where they are now.
 * 3. LinkedIn logged in, only when the client allows it and search left the
 *    answer open: read the profiles search half-matched, else search LinkedIn
 *    itself, and trust a profile only when a role on it is at the firm. The
 *    account's daily caps are autobrowse's; a 429 parks the person until then.
 *
 * Pure over a SiteClient: it returns findings and the trail, `store.ts` writes.
 */
import { isFreemail } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import type { FindingKind, LookupState } from "../schema.js";
import {
  companyPhrase,
  domainLabel,
  type Firm,
  firmNames,
  isFirm,
  mentionsFirm,
  sameName,
} from "./names.js";
import { experienceOf, linkedinProfile, type ProfileLink, readSerpTitle } from "./serp.js";

export interface LookupSubject {
  personId: number;
  firstName: string | null;
  lastName: string | null;
  /** The firm we knew them at. */
  firm: Firm;
  /** A profile an earlier read already tied to them. */
  linkedinUrl: string | null;
  /** The latest check of the address we hold for them. */
  email: { address: string; result: string; verifier: string } | null;
}

export interface DocumentDraft {
  url: string;
  kind: "snippet" | "profile";
  title: string | null;
  text: string;
  /** Who fetched it: the search backend, or `linkedin`. */
  fetchTier: string;
}

export interface FindingDraft {
  kind: FindingKind;
  personId: number;
  /** Subject, kind, how we know, what: seeing it again is the same fact. */
  factKey: string;
  value: Record<string, unknown>;
  confidence: number;
  via: string;
  sourceUrl: string | null;
  document: DocumentDraft | null;
}

export interface Tried {
  step: "email" | "search" | "profile" | "linkedin search" | "capped";
  what: string;
  outcome: string;
}

export interface LookupResult {
  state: LookupState;
  /** The profile we trust as this person; null unless matched. */
  profile: ProfileLink | null;
  findings: FindingDraft[];
  tried: Tried[];
  retryAt: Date | null;
  /** The site whose cap parked this person; null unless capped. */
  cappedBy: string | null;
}

export interface LookupOptions {
  /** The account for logged-in LinkedIn reads (`linkedin@research`); null = never log in. */
  linkedin: string | null;
  /** A cap an earlier person in this run hit: park at step 3 instead of asking again. */
  linkedinCappedUntil?: Date | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** How sure each reading is that the fact is true of this person today. */
const SURE = {
  mailboxGone: 0.6,
  domainGone: 0.4,
  mailboxLive: 0.5,
  searchThere: 0.7,
  searchMoved: 0.6,
  profile: 0.9,
  profileNoCurrent: 0.6,
} as const;
/** Profiles read per person at most: the profile cap is shared by the whole list. */
const MAX_PROFILE_READS = 3;
const SEARCH_HITS = 5;
/**
 * A 429 asking for this long or less is pacing: wait and ask again. Longer is
 * a daily cap. autobrowse refuses a paced call once its slot is 2+ minutes out.
 */
const PACE_MAX_S = 300;
const PACE_TRIES = 3;

interface Hits {
  hits: { title: string; url: string; snippet: string | null }[];
  via: string;
}
interface Role {
  title: string;
  company: string;
  companyUrl: string;
  dates?: string;
  current: boolean;
}
interface Profile {
  name: string;
  headline?: string;
  roles?: Role[];
}
interface PersonHit {
  name: string;
  url: string;
  headline?: string;
  current?: string;
  past?: string;
}

/** A daily cap said stop: when to try again. */
class Capped extends Error {
  constructor(
    readonly site: string,
    readonly retryAt: Date,
    readonly why: string,
  ) {
    super(why);
  }
}

const key = (s: LookupSubject, kind: FindingKind, via: string, detail: string) =>
  `p${s.personId}:${kind}:${via}:${detail}`.slice(0, 400);
const firmLabel = (f: Firm) => f.name ?? f.domain ?? "";

/** Is this the firm's own mail domain (or one under it)? */
const firmDomain = (domain: string, firm: Firm): boolean => {
  const d = domain.toLowerCase();
  const f = firm.domain?.toLowerCase().replace(/^www\./, "");
  if (f) return d === f || d.endsWith(`.${f}`);
  const label = domainLabel(d);
  return !!label && isFirm(label, firm);
};

/**
 * Step 1: what the address check already says, only for an address at the
 * firm's own domain: a live mailbox elsewhere says nothing about the firm, and
 * a typo domain that takes no mail says nothing about the person.
 */
export function emailFindings(s: LookupSubject): FindingDraft[] {
  const e = s.email;
  if (!e) return [];
  const domain = e.address.split("@")[1] ?? "";
  if (!domain || isFreemail(domain) || !firmDomain(domain, s.firm)) return [];
  const finding = (kind: FindingKind, reason: string, confidence: number): FindingDraft => ({
    kind,
    personId: s.personId,
    factKey: key(s, kind, "email", e.address),
    value: { email: e.address, reason, ...(kind === "left" ? { from: firmLabel(s.firm) } : {}) },
    confidence,
    via: "email",
    sourceUrl: null,
    document: null,
  });
  if (e.result === "invalid")
    return e.verifier === "local"
      ? [finding("left", "the domain takes no mail", SURE.domainGone)]
      : [finding("left", "the mailbox rejects mail", SURE.mailboxGone)];
  if (e.result === "valid")
    return [finding("still_there", "the mailbox takes mail", SURE.mailboxLive)];
  return [];
}

/** Where they work now, per one reading, against where they worked. */
function employerFinding(
  s: LookupSubject,
  now: { company: string; title: string | null; dates?: string | null; companyUrl?: string },
  via: string,
  link: ProfileLink,
  document: DocumentDraft,
  sure: { there: number; moved: number },
): FindingDraft {
  const there = isFirm(now.company, s.firm);
  const kind: FindingKind = there ? "still_there" : "job_change";
  return {
    kind,
    personId: s.personId,
    factKey: key(s, kind, via, `${link.vanity}:${companyPhrase(now.company)}`),
    value: there
      ? { company: now.company, title: now.title, dates: now.dates ?? null }
      : {
          from: firmLabel(s.firm),
          to: now.company,
          title: now.title,
          dates: now.dates ?? null,
          companyUrl: now.companyUrl ?? null,
        },
    confidence: there ? sure.there : sure.moved,
    via,
    sourceUrl: link.url,
    document,
  };
}

/**
 * A profile's roles as one fact: still at the firm, moved, or no current role
 * at all. A read with no roles says nothing: they may just not have come back.
 */
function profileFinding(
  s: LookupSubject,
  p: Profile,
  via: string,
  link: ProfileLink,
  document: DocumentDraft,
): FindingDraft | null {
  const roles = p.roles ?? [];
  if (!roles.length) return null;
  const current = roles.filter((r) => r.current);
  const now = current.find((r) => isFirm(r.company, s.firm)) ?? current[0];
  if (now)
    return employerFinding(s, now, via, link, document, {
      there: SURE.profile,
      moved: SURE.profile,
    });
  const last = roles.find((r) => isFirm(r.company, s.firm));
  return {
    kind: "left",
    personId: s.personId,
    factKey: key(s, "left", via, link.vanity),
    value: { from: firmLabel(s.firm), reason: "no current role", lastRole: last ?? null },
    confidence: SURE.profileNoCurrent,
    via,
    sourceUrl: link.url,
    document,
  };
}

/** A 4xx that says no to this one request (private profile, not found); null for anything else. */
const refusedBy = (err: unknown): number | null =>
  err instanceof SiteCallError && err.status >= 400 && err.status < 500 ? err.status : null;

/** Seconds a 429 asks us to wait; null for any other error. No figure = an hour. */
function retryAfter(err: unknown): number | null {
  if (!(err instanceof SiteCallError) || err.status !== 429) return null;
  return Number(/retry after (\d+)s/.exec(err.message)?.[1] ?? 3_600);
}

export async function lookUpPerson(
  sites: SiteClient,
  s: LookupSubject,
  opts: LookupOptions,
): Promise<LookupResult> {
  const clock = opts.now ?? (() => new Date());
  const call = paced(sites, clock, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  const tried: Tried[] = [];
  const findings = emailFindings(s);
  for (const f of findings)
    tried.push({
      step: "email",
      what: String(f.value.email),
      outcome: `${f.kind}: ${f.value.reason}`,
    });
  const done = (
    state: LookupState,
    profile: ProfileLink | null,
    capped: Capped | null = null,
  ): LookupResult => ({
    state,
    profile,
    findings,
    tried,
    retryAt: capped?.retryAt ?? null,
    cappedBy: capped?.site ?? null,
  });

  const names = firmNames(s.firm);
  const firm = names[0];
  if (!s.firstName || !s.lastName || !firm) {
    tried.push({
      step: "search",
      what: "-",
      outcome: !firm ? "no firm name to match on" : "no first and last name to match on",
    });
    return done("unresolved", null);
  }
  const who = `${s.firstName} ${s.lastName}`;

  let profile: ProfileLink | null = null;
  let status: FindingDraft | null = null;
  /** Profiles whose name matched but whose result did not name the firm. */
  const maybe: ProfileLink[] = [];
  const known = s.linkedinUrl ? linkedinProfile(s.linkedinUrl) : null;
  if (known) maybe.push(known);
  try {
    // Step 2: search, at most two queries.
    for (const q of [`"${who}" "${firm}" site:linkedin.com/in`, `${who} ${firm} linkedin`]) {
      const res = await call<Hits>("web", "GET", "/search", { q, n: SEARCH_HITS });
      const outcome: string[] = [`${res.hits.length} hits via ${res.via}`];
      for (const h of res.hits) {
        const link = linkedinProfile(h.url);
        const read = link ? readSerpTitle(h.title) : null;
        if (!link || !read) continue;
        if (!sameName(s, read.name)) {
          outcome.push(`${link.vanity}: name differs (${read.name})`);
          continue;
        }
        const text = `${h.title}\n${h.snippet ?? ""}`;
        // Their own name is not the firm's, even at "Doe LLC".
        if (!mentionsFirm(text, s.firm, [read.name, who])) {
          if (!maybe.some((m) => m.vanity === link.vanity)) maybe.push(link);
          outcome.push(`${link.vanity}: name matches, firm not named`);
          continue;
        }
        profile = link;
        outcome.push(`${link.vanity}: matched`);
        // LinkedIn's own "Experience:" first; a bare "Name - X" only as the firm itself.
        const company =
          experienceOf(h.snippet) ??
          read.company ??
          (read.bare && isFirm(read.bare, s.firm) ? read.bare : null);
        if (company)
          status = employerFinding(
            s,
            { company, title: read.title },
            "search",
            link,
            {
              url: link.url,
              kind: "snippet",
              title: h.title,
              text,
              fetchTier: res.via.slice(0, 16),
            },
            { there: SURE.searchThere, moved: SURE.searchMoved },
          );
        break;
      }
      tried.push({ step: "search", what: q, outcome: outcome.join("; ") });
      if (profile) break;
    }

    // Step 3: LinkedIn logged in, only while where they are now is still open.
    if (!status && opts.linkedin) {
      const account = opts.linkedin;
      const until = opts.linkedinCappedUntil;
      if (until && until > clock())
        throw new Capped("linkedin", until, "linkedin cap hit earlier this run");
      const read = new Set<string>();
      const check = async (link: ProfileLink): Promise<boolean> => {
        if (read.has(link.vanity) || read.size >= MAX_PROFILE_READS) return false;
        read.add(link.vanity);
        let p: Profile;
        try {
          p = await call<Profile>(
            "linkedin",
            "GET",
            `/in/${link.vanity}`,
            { experience: true },
            account,
          );
        } catch (err) {
          const status = refusedBy(err);
          if (status === null) throw err;
          tried.push({ step: "profile", what: link.vanity, outcome: `refused: ${status}` });
          return false;
        }
        const atFirm = (p.roles ?? []).some((r) => isFirm(r.company, s.firm));
        const named = sameName(s, p.name);
        const ok = named && (atFirm || link.vanity === profile?.vanity);
        tried.push({
          step: "profile",
          what: link.vanity,
          outcome: ok ? "matched" : !named ? `name differs (${p.name})` : "no role at the firm",
        });
        // The logged-in read beats the search result: a different name there
        // means search matched the wrong profile.
        if (!named && link.vanity === profile?.vanity) profile = null;
        if (!ok) return false;
        profile = link;
        status = profileFinding(s, p, account, link, {
          url: link.url,
          kind: "profile",
          title: p.name,
          text: JSON.stringify(p),
          fetchTier: "linkedin",
        });
        return true;
      };

      const first: ProfileLink[] = profile ? [profile] : maybe;
      let found = false;
      for (const link of first) if (!found) found = await check(link);
      if (!found && !profile && read.size < MAX_PROFILE_READS) {
        const keywords = `${who} ${firm}`;
        let res: { people: PersonHit[] };
        try {
          res = await call("linkedin", "GET", "/search/results/people", { keywords }, account);
        } catch (err) {
          const status = refusedBy(err);
          if (status === null) throw err;
          tried.push({ step: "linkedin search", what: keywords, outcome: `refused: ${status}` });
          res = { people: [] };
        }
        const named = res.people.filter((h) => sameName(s, h.name));
        const says = (h: PersonHit) =>
          mentionsFirm(`${h.headline ?? ""}\n${h.current ?? ""}\n${h.past ?? ""}`, s.firm);
        // Rows that name the firm first; a bare name match only when none do.
        const order = named.some(says) ? named.filter(says) : named;
        tried.push({
          step: "linkedin search",
          what: keywords,
          outcome: `${res.people.length} people, ${named.length} by name, ${named.filter(says).length} naming the firm`,
        });
        for (const h of order) {
          const link = linkedinProfile(h.url);
          if (link && !found) found = await check(link);
        }
      }
    }
  } catch (err) {
    if (err instanceof Capped) {
      tried.push({
        step: "capped",
        what: err.why,
        outcome: `retry at ${err.retryAt.toISOString()}`,
      });
      if (status) findings.push(status);
      return done("capped", profile, err);
    }
    throw err;
  }
  if (status) findings.push(status);
  return done(profile ? "matched" : "unresolved", profile);
}

/**
 * SiteClient.call that waits out pacing (a short 429) and turns a daily cap
 * (a long one) into Capped.
 */
function paced(sites: SiteClient, clock: () => Date, sleep: (ms: number) => Promise<void>) {
  return async <T>(...args: Parameters<SiteClient["call"]>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await sites.call<T>(...args);
      } catch (err) {
        const secs = retryAfter(err);
        if (secs === null || !(err instanceof SiteCallError)) throw err;
        if (secs > PACE_MAX_S || attempt >= PACE_TRIES)
          throw new Capped(err.site, new Date(clock().getTime() + secs * 1000), err.message);
        await sleep(secs * 1000);
      }
    }
  };
}

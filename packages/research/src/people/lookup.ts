/**
 * Person lookup (R7): where is this person now? Layered, cheapest and safest
 * first, and never a guess:
 *
 * 1. The email check already run. A work mailbox that rejects mail says they
 *    probably left; one that accepts says they may still be there.
 * 2. Held links, read from Exa's cache of LinkedIn (`web` `/linkedin/profile`;
 *    nothing reaches linkedin.com): the profile we already hold (its name
 *    matching is enough), then links beside their name on the firm's own pages.
 * 3. Google, only when the caller allows it (signed out, capped, daytime):
 *    `site:linkedin.com/in "First Last" "Firm"`, name-matched hits read from
 *    the cache. A Google that stops answering (a cap, a sorry page) is
 *    reported in `googleStopped`, never fatal: the lookup goes on without it.
 * 4. People search (`web` `/people`, an index of public profiles), only when
 *    nothing above matched.
 *
 *    A reading is trusted by R7's rule: the name matches and a role is at the
 *    firm. A cached or indexed copy can lag the profile by months, so it is
 *    trusted a little less than a logged-in read.
 * 5. LinkedIn logged in, only when the client allows it and search left the
 *    answer open: read the profiles search half-matched, else search LinkedIn
 *    itself, and trust a profile only when a role on it is at the firm. The
 *    account's daily caps are autobrowse's; a 429 parks the person until then.
 *
 * Pure over a SiteClient: it returns findings, every page read and the trail;
 * `store.ts` writes.
 */
import { isFreemail } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { DocumentDraft, FindingDraft } from "../findings.js";
import { Capped, failedRead, paced, realSleep, refusedBy } from "../pacing.js";
import type { FindingKind, LookupState } from "../schema.js";
import {
  bareCompanyName,
  companyPhrase,
  domainLabel,
  type Firm,
  firmNames,
  isFirm,
  mentionsFirm,
  sameName,
} from "./names.js";
import { linkedinProfile, type ProfileLink } from "./profile-link.js";

export type { DocumentDraft, FindingDraft } from "../findings.js";

export interface LookupSubject {
  personId: number;
  firstName: string | null;
  lastName: string | null;
  /** The firm we knew them at. */
  firm: Firm;
  /** A profile an earlier read already tied to them. */
  linkedinUrl: string | null;
  /** Profile links found beside their name on the firm's own pages (team pages). */
  pageLinks?: string[];
  /** The latest check of the address we hold for them. */
  email: { address: string; result: string; verifier: string } | null;
}

export interface Tried {
  step: "email" | "cache" | "google" | "search" | "profile" | "linkedin search" | "capped";
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
  /** Every profile page read from the cache, theirs or not: nothing read is dropped. */
  pages: DocumentDraft[];
  /** Google stopped answering (a cap, a sorry page): until when, null = the rest of the day. */
  googleStopped: { until: Date | null; why: string } | null;
}

export interface LookupOptions {
  /** The account for logged-in LinkedIn reads (`linkedin@research`); null = never log in. */
  linkedin: string | null;
  /** Search Google for the profile (step 3). The caller keeps its daily budget and hours. */
  google?: boolean;
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
  profile: 0.9,
  profileNoCurrent: 0.6,
  indexed: 0.8,
  indexedNoCurrent: 0.5,
} as const;
type Sure = { there: number; moved: number; noCurrent: number };
const READ: Sure = {
  there: SURE.profile,
  moved: SURE.profile,
  noCurrent: SURE.profileNoCurrent,
};
const INDEXED: Sure = {
  there: SURE.indexed,
  moved: SURE.indexed,
  noCurrent: SURE.indexedNoCurrent,
};
/** Profiles read per person at most: the profile cap is shared by the whole list. */
const MAX_PROFILE_READS = 3;
/** Cache reads per person at most, held links and Google hits together. */
const MAX_CACHE_READS = 3;
const SEARCH_PEOPLE = 5;
const GOOGLE_RESULTS = 10;
/** Who read the page: Exa's cache of LinkedIn. */
export const CACHE_VIA = "exa-cache";

interface Role {
  title: string;
  company: string;
  companyUrl?: string | null;
  dates?: string | null;
  current: boolean;
}
interface Profile {
  name: string;
  headline?: string | null;
  roles?: Role[];
}
interface People {
  people: (Profile & { url: string })[];
  via: string;
}
interface CachedProfile extends Profile {
  text?: string;
}
interface Serp {
  results: { title: string; url: string; snippet?: string }[];
}
interface PersonHit {
  name: string;
  url: string;
  headline?: string;
  current?: string;
  past?: string;
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
  now: Role,
  via: string,
  link: ProfileLink,
  document: DocumentDraft,
  sure: Sure,
): FindingDraft {
  const there = isFirm(now.company, s.firm);
  const kind: FindingKind = there ? "still_there" : "job_change";
  return {
    kind,
    personId: s.personId,
    factKey: key(s, kind, via, `${link.vanity}:${companyPhrase(now.company)}`),
    value: there
      ? // companyUrl: the firm's own LinkedIn page, so company research needs no search for it.
        {
          company: now.company,
          title: now.title,
          dates: now.dates ?? null,
          companyUrl: now.companyUrl ?? null,
        }
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
  sure: Sure,
): FindingDraft | null {
  const roles = p.roles ?? [];
  if (!roles.length) return null;
  const current = roles.filter((r) => r.current);
  const now = current.find((r) => isFirm(r.company, s.firm)) ?? current[0];
  if (now) return employerFinding(s, now, via, link, document, sure);
  const last = roles.find((r) => isFirm(r.company, s.firm));
  return {
    kind: "left",
    personId: s.personId,
    factKey: key(s, "left", via, link.vanity),
    value: { from: firmLabel(s.firm), reason: "no current role", lastRole: last ?? null },
    confidence: sure.noCurrent,
    via,
    sourceUrl: link.url,
    document,
  };
}

export async function lookUpPerson(
  sites: SiteClient,
  s: LookupSubject,
  opts: LookupOptions,
): Promise<LookupResult> {
  const clock = opts.now ?? (() => new Date());
  const call = paced(sites, clock, opts.sleep ?? realSleep);
  const tried: Tried[] = [];
  const pages: DocumentDraft[] = [];
  let googleStopped: LookupResult["googleStopped"] = null;
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
    pages,
    googleStopped,
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
  const addMaybe = (link: ProfileLink) => {
    if (!maybe.some((m) => m.vanity === link.vanity)) maybe.push(link);
  };
  let known = s.linkedinUrl ? linkedinProfile(s.linkedinUrl) : null;
  if (known) maybe.push(known);
  const cacheRead = new Set<string>();
  /**
   * One profile from Exa's cache. Theirs when the name matches and a role is at
   * the firm; the profile we already hold needs the name only. No cached copy
   * (404) leaves the link a candidate.
   */
  const readCached = async (link: ProfileLink, from: string): Promise<boolean> => {
    if (cacheRead.has(link.vanity) || cacheRead.size >= MAX_CACHE_READS) {
      addMaybe(link);
      return false;
    }
    cacheRead.add(link.vanity);
    let p: CachedProfile;
    try {
      p = await call<CachedProfile>("web", "GET", "/linkedin/profile", { url: link.url });
    } catch (err) {
      const refused = refusedBy(err);
      if (refused === null) throw err;
      tried.push({
        step: "cache",
        what: `${link.vanity} (${from})`,
        outcome: refused === 404 ? "no cached copy" : `refused: ${refused}`,
      });
      addMaybe(link);
      return false;
    }
    const doc: DocumentDraft = {
      url: link.url,
      kind: "profile",
      title: p.name,
      text: p.text || JSON.stringify(p),
      fetchTier: CACHE_VIA,
    };
    pages.push(doc);
    const named = sameName(s, p.name);
    const atFirm = (p.roles ?? []).some((r) => isFirm(r.company, s.firm));
    const ok = named && (atFirm || link.vanity === known?.vanity);
    tried.push({
      step: "cache",
      what: `${link.vanity} (${from})`,
      outcome: ok ? "matched" : !named ? `name differs (${p.name})` : "no role at the firm",
    });
    if (!named && link.vanity === known?.vanity) {
      // The profile we held is someone else's: stop trusting it anywhere.
      known = null;
      maybe.splice(0, maybe.length, ...maybe.filter((m) => m.vanity !== link.vanity));
    }
    if (!ok) {
      if (named) addMaybe(link);
      return false;
    }
    profile = link;
    status = profileFinding(s, p, CACHE_VIA, link, doc, INDEXED);
    return true;
  };

  async function googleStep(firmName: string): Promise<void> {
    const q = `site:linkedin.com/in "${who}" "${bareCompanyName(firmName)}"`;
    let res: Serp;
    try {
      res = await call<Serp>("web", "GET", "/google", { q, n: GOOGLE_RESULTS });
    } catch (err) {
      const refused = refusedBy(err);
      if (err instanceof Capped) googleStopped = { until: err.retryAt, why: err.why };
      else if (failedRead(err, "web")) googleStopped = { until: null, why: (err as Error).message };
      else if (refused === null) throw err;
      tried.push({
        step: "google",
        what: q,
        outcome: googleStopped ? `stopped: ${googleStopped.why}` : `refused: ${refused}`,
      });
      return;
    }
    // Titles read "Name - Title - Company | LinkedIn".
    const hits = (res.results ?? []).flatMap((h) => {
      const link = linkedinProfile(h.url);
      const name = h.title.split(/\s+[-–|]\s+/)[0] ?? "";
      if (!link || !sameName(s, name)) return [];
      return [{ link, says: mentionsFirm(`${h.title}\n${h.snippet ?? ""}`, s.firm, [who]) }];
    });
    // Hits that name the firm first; a bare name match only when none do.
    const naming = hits.filter((h) => h.says);
    tried.push({
      step: "google",
      what: q,
      outcome: `${res.results?.length ?? 0} results, ${hits.length} by name, ${naming.length} naming the firm`,
    });
    for (const h of naming.length ? naming : hits)
      if (!profile && (await readCached(h.link, "google"))) break;
    for (const h of hits) if (h.link.vanity !== profile?.vanity) addMaybe(h.link);
  }

  try {
    // Step 2: links we already hold.
    const held = [
      ...(known ? [{ link: known, from: "held" }] : []),
      ...(s.pageLinks ?? []).flatMap((u) => {
        const link = linkedinProfile(u);
        return link ? [{ link, from: "their firm's page" }] : [];
      }),
    ];
    for (const h of held) if (!profile && (await readCached(h.link, h.from))) break;

    // Step 3: Google, signed out. Its failures stop Google, never the lookup.
    if (!profile && opts.google) await googleStep(firm);

    // Step 4: one people search, only when nothing above matched; each profile carries its roles.
    const q = `${who} ${firm}`;
    if (!profile) {
      const res = await call<People>("web", "GET", "/people", { q, n: SEARCH_PEOPLE });
      const outcome: string[] = [`${res.people.length} people via ${res.via}`];
      for (const p of res.people) {
        const link = linkedinProfile(p.url);
        if (!link) continue;
        if (!sameName(s, p.name)) {
          outcome.push(`${link.vanity}: name differs (${p.name})`);
          continue;
        }
        // A role at the firm ties the profile to them; the one we already hold needs none.
        const atFirm = (p.roles ?? []).some((r) => isFirm(r.company, s.firm));
        if (!atFirm && link.vanity !== known?.vanity) {
          addMaybe(link);
          outcome.push(`${link.vanity}: name matches, no role at the firm`);
          continue;
        }
        profile = link;
        status = profileFinding(
          s,
          p,
          "search",
          link,
          {
            url: link.url,
            kind: "profile",
            title: p.name,
            text: JSON.stringify(p),
            fetchTier: res.via.slice(0, 16),
          },
          INDEXED,
        );
        outcome.push(`${link.vanity}: matched`);
        break;
      }
      tried.push({ step: "search", what: q, outcome: outcome.join("; ") });
    }

    // Step 5: LinkedIn logged in, only while where they are now is still open.
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
        status = profileFinding(
          s,
          p,
          account,
          link,
          {
            url: link.url,
            kind: "profile",
            title: p.name,
            text: JSON.stringify(p),
            fetchTier: "linkedin",
          },
          READ,
        );
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

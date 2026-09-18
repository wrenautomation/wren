/**
 * Deterministic testimonial-author tagging over already-extracted people. Some
 * "people" on a company's site are its clients quoted in a testimonial
 * ("President, Cordelia Labs"). They are stored like everyone else but must never
 * be enrolled under the company that quoted them. Prompt v2 tags at the source;
 * this is the backfill for v1 rows and a cheap second opinion.
 *
 * Precision beats recall, asymmetrically: a false positive silently deletes a real
 * founder from the only send list we have. The rules are reasons to REJECT.
 */
import { type Company, companies, type Person, people } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, count, eq } from "drizzle-orm";

export interface TestimonialTag {
  org: string;
  method: "title_org_suffix" | "title_proper_noun" | "title_proper_noun_testimonial_page";
  matched: string;
}

const vocabulary = (text: string): ReadonlySet<string> =>
  new Set(text.split(/\s+/).filter(Boolean));

/** "President, Cordelia Labs": an employer follows these. Spaces kept so "Co-Founder" survives " - ". */
const EMPLOYER_SEPARATORS = [", ", " at ", " @ ", " with "] as const;
/** "Director of Client Onboarding": reads as "responsible for", so only an explicit company suffix counts. */
const SCOPE_SEPARATORS = [" of ", " - ", " – ", " | "] as const;
const SEPARATORS = [...EMPLOYER_SEPARATORS, ...SCOPE_SEPARATORS];

const ROLE_WORDS = vocabulary(`
    founder cofounder ceo coo cfo cto cmo cro cxo cio chief officer
    president vp evp svp avp vice director head lead leader leadership
    manager management partner principal owner proprietor strategist
    consultant consulting advisor adviser executive senior junior sr jr
    associate specialist expert certified analyst producer copywriter
    writer editor engineer architect recruiter coordinator assistant
    ambassador emeritus board chair chairman chairwoman general counsel
    intern staff member employee
`);
const FUNCTION_WORDS = vocabulary(`
    strategy strategic planning design designs designer creative content
    development dev developer engineering marketing advertising branding
    brand operations ops sales revenue growth account accounts client
    clients customer business commercial enterprise corporate partnership
    partnerships alliances relations relationship
    relationships communications communication pr publicity affairs
    outreach community culture people talent hr recruiting recruitment
    finance financial accounting legal compliance quality security risk
    product project program portfolio delivery implementation integration
    onboarding optimization performance analytics analysis insights
    insight research immersion innovation transformation experience
    success support service services maintenance helpdesk infrastructure
    systems system technology technical it data ai ml
    automation cloud web website websites digital ecommerce commerce
    social media email seo sem ppc paid organic search links link
    building affiliate influencer programmatic mobile video photography
    photographer cinematographer film production post print copy
    editorial art ux ui crm cms erp saas practice department
    division unit team squad pod studio education events training
    learning acquisition retention engagement enablement processing
    placement oversight solutions advisory intelligence
    artificial ads adwords engine engines platforms centers center
    excellence retail distribution logistics procurement merchandising
    storyteller visual
`);
const WHIMSY_WORDS = vocabulary("wizard magician magic maker guru ninja rockstar jack trades");
const PLACE_WORDS = vocabulary(`
    america americas africa europe asia australia canada mexico brazil
    germany france spain italy netherlands poland ukraine india china
    japan singapore emea apac latam usa uk us gb england scotland ireland
    london york angeles francisco chicago boston toronto sydney dubai
    global international national regional domestic east west north south
    central latin middle nordic benelux
`);
const NOT_AN_EMPLOYER = new Set([
  ...ROLE_WORDS,
  ...FUNCTION_WORDS,
  ...PLACE_WORDS,
  ...WHIMSY_WORDS,
]);
const NOT_AN_EMPLOYER_PHRASES = [
  "client services",
  "business development",
  "human resources",
] as const;

/** A trailing phrase ending in one of these is an organization. Concrete nouns only. */
const ORG_SUFFIXES = vocabulary(`
    inc llc llp ltd plc co corp corporation company companies incorporated
    gmbh bv ab oy sa nv pty
    labs laboratories group holdings ventures capital investments partners
    associates foundation institute trust university college school academy
    hospital clinic dental dentistry health medical pharmacy veterinary
    bank credit union insurance realty properties homes construction
    brewing brewery distillery winery vineyards coffee roasters bakery
    kitchen steakhouse restaurant cafe bistro catering salon spa fitness
    gym outfitters traders trading supply supplies manufacturing motors
    automotive airlines hotels resorts church ministries
`);
/** Legal and descriptive noise dropped from BOTH sides when asking "is this the company's own name?". */
const COMPANY_NOISE = vocabulary(`
    inc llc llp ltd plc co corp corporation company the and of
    com net io www agency agencies studio studios group digital media
    creative design designs marketing partners
`);
/** A URL path that is about clients relaxes the two-word requirement, and only that. */
const TESTIMONIAL_PATH =
  /testimonial|review|client|case-stud|casestud|success|stories|portfolio|our-work/i;
const WORDS = /[A-Za-z0-9]+/g;
const MAX_ORG_WORDS = 5;

const tokens = (text: string): string[] => (text.match(WORDS) ?? []).map((w) => w.toLowerCase());
const isUpperOrDigit = (ch: string | undefined): boolean =>
  ch !== undefined && (/\d/.test(ch) || (ch !== ch.toLowerCase() && ch === ch.toUpperCase()));

function namesARole(text: string): boolean {
  const lowered = text.toLowerCase();
  if (NOT_AN_EMPLOYER_PHRASES.some((phrase) => lowered.includes(phrase))) return true;
  return tokens(text).some((token) => NOT_AN_EMPLOYER.has(token));
}

function orgMethod(
  raw: string,
  suffixRequired: boolean,
  allowSingleWord: boolean,
): TestimonialTag["method"] | null {
  const phrase = raw.trim().replace(/^[.,;:]+|[.,;:]+$/g, "");
  if (!phrase || namesARole(phrase)) return null;
  if (!isUpperOrDigit(phrase[0])) return null;
  const words = phrase.split(/\s+/);
  if (words.length < 1 || words.length > MAX_ORG_WORDS) return null;
  if (!words.some((w) => isUpperOrDigit(w[0]))) return null;
  const toks = tokens(phrase);
  const last = toks[toks.length - 1];
  if (!last) return null;
  if (ORG_SUFFIXES.has(last)) return "title_org_suffix";
  if (suffixRequired) return null;
  if (words.length >= 2) return "title_proper_noun";
  return allowSingleWord ? "title_proper_noun_testimonial_page" : null;
}

const companyWords = (name: string): string[] => tokens(name).filter((t) => !COMPANY_NOISE.has(t));

/** True when the trailing phrase is (a piece of) the company's own name: any shared distinctive word, or a squashed substring. */
export function isOwnCompany(org: string, companyName: string | null | undefined): boolean {
  const orgWords = companyWords(org);
  if (!orgWords.length) return true;
  if (!companyName) return false;
  const cw = companyWords(companyName);
  if (!cw.length) return false;
  if (orgWords.some((w) => cw.includes(w))) return true;
  const squashedOrg = orgWords.join("");
  const squashedCompany = cw.join("");
  return squashedCompany.includes(squashedOrg) || squashedOrg.includes(squashedCompany);
}

function findAll(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let start = haystack.indexOf(needle);
  while (start !== -1) {
    found.push(start);
    start = haystack.indexOf(needle, start + 1);
  }
  return found;
}

/** The testimonial tag a title carries, or null for ordinary staff. Scans separator positions from the end. */
export function classifyTitle(
  title: string | null | undefined,
  opts: { companyName: string | null | undefined; documentUrl?: string | null | undefined },
): TestimonialTag | null {
  if (!title?.trim()) return null;
  const clean = title.trim();
  const allowSingleWord = Boolean(opts.documentUrl && TESTIMONIAL_PATH.test(opts.documentUrl));
  const lowered = clean.toLowerCase();
  const positions: Array<[number, string]> = [];
  for (const separator of SEPARATORS)
    for (const index of findAll(lowered, separator)) positions.push([index, separator]);
  positions.sort((a, b) => b[0] - a[0] || (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  for (const [index, separator] of positions) {
    const phrase = clean.slice(index + separator.length).trim();
    const method = orgMethod(
      phrase,
      (SCOPE_SEPARATORS as readonly string[]).includes(separator),
      allowSingleWord,
    );
    if (method === null) continue;
    if (isOwnCompany(phrase, opts.companyName)) return null;
    return { org: phrase, method, matched: phrase };
  }
  return null;
}

/** The page this person was read off: origin_ref "enrichment:<id> <url>" or raw._document_url. */
export function documentUrlFrom(person: Pick<Person, "originRef" | "raw">): string | null {
  const space = (person.originRef ?? "").indexOf(" ");
  const tail = space >= 0 ? person.originRef.slice(space + 1).trim() : "";
  if (tail) return tail;
  const raw = (person.raw ?? {}) as Record<string, unknown>;
  return typeof raw._document_url === "string" && raw._document_url ? raw._document_url : null;
}

export interface TagTestimonialsOptions {
  niche: string;
  runId?: string | null;
  dryRun?: boolean;
  limit?: number;
  checkpoint?: () => void | Promise<void>;
}

export interface TestimonialCandidate {
  person_id: number;
  full_name: string;
  title: string | null;
  company_name: string | null;
  org: string;
  method: string;
}

export interface TagTestimonialsStats extends Record<string, unknown> {
  scanned: number;
  tagged: number;
  skipped_already_tagged: number;
  dry_run: boolean;
  candidates?: TestimonialCandidate[];
}

const CHECKPOINT_EVERY = 200;

/** Tag website-extracted people of a niche whose title names a client company. Idempotent. */
export async function tagTestimonials(
  db: Queryable,
  opts: TagTestimonialsOptions,
): Promise<TagTestimonialsStats> {
  const inScope = and(eq(companies.niche, opts.niche), eq(people.origin, "website"));
  const [already] = await db
    .select({ n: count() })
    .from(people)
    .innerJoin(companies, eq(people.companyId, companies.id))
    .where(and(inScope, eq(people.isTestimonial, true)));
  const q = db
    .select({ person: people, company: companies })
    .from(people)
    .innerJoin(companies, eq(people.companyId, companies.id))
    .where(and(inScope, eq(people.isTestimonial, false)))
    .orderBy(asc(people.id));
  const rows: Array<{ person: Person; company: Company }> =
    opts.limit === undefined ? await q : await q.limit(opts.limit);
  const dryRun = opts.dryRun ?? false;
  const stats: TagTestimonialsStats = {
    scanned: 0,
    tagged: 0,
    skipped_already_tagged: already?.n ?? 0,
    dry_run: dryRun,
  };
  const candidates: TestimonialCandidate[] = [];
  let written = 0;
  for (const { person, company } of rows) {
    stats.scanned += 1;
    const tag = classifyTitle(person.title, {
      companyName: company.name,
      documentUrl: documentUrlFrom(person),
    });
    if (!tag) continue;
    stats.tagged += 1;
    if (dryRun) {
      candidates.push({
        person_id: person.id,
        full_name: person.fullName,
        title: person.title,
        company_name: company.name,
        org: tag.org,
        method: tag.method,
      });
      continue;
    }
    await db
      .update(people)
      .set({
        isTestimonial: true,
        testimonialOrg: tag.org,
        raw: {
          ...((person.raw ?? {}) as Record<string, unknown>),
          testimonial_tag: { method: tag.method, matched: tag.matched, run_id: opts.runId ?? null },
        },
      })
      .where(eq(people.id, person.id));
    written += 1;
    if (written % CHECKPOINT_EVERY === 0 && opts.checkpoint) await opts.checkpoint();
  }
  if (dryRun) stats.candidates = candidates;
  return stats;
}

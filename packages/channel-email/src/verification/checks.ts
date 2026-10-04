/**
 * Cross-checks: is this the right person at the right address? An SMTP verdict
 * says the mailbox exists, not that it is this person's or that they still work
 * there. Each check reads data already held (no calls) and says pass, fail or
 * unknown, with the evidence it judged on. Design: 2026-10-03-lead-sheet.
 */
import { extractDomain, isRoleLocalpart, parseDirectName, registrableDomain } from "@wren/core";
import { firmSite } from "@wren/research/companies";
import { plain } from "@wren/research/people";
import type { LeadCheckKind, LeadCheckResult } from "../schema.js";

export interface CheckOutcome {
  readonly kind: LeadCheckKind;
  readonly result: LeadCheckResult;
  readonly evidence: Record<string, unknown>;
}

export interface NamedPerson {
  readonly id: number;
  readonly fullName: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
}

/** The newest of a person's `still_there` / `job_change` / `left` findings. */
export interface LookupFinding {
  readonly id: number;
  readonly kind: string;
  readonly confidence: number;
  readonly value: Record<string, unknown>;
}

/** The firm's trusted LinkedIn page (findings kind `profile`). */
export interface CompanyPage {
  readonly id: number;
  readonly value: Record<string, unknown>;
}

/** compose's moved-on rule: a lookup this sure says they left. */
export const MOVED_ON_CONFIDENCE = 0.8;

const outcome = (
  kind: LeadCheckKind,
  result: LeadCheckResult,
  evidence: Record<string, unknown> = {},
): CheckOutcome => ({ kind, result, evidence });

/** The local part as a name pattern reads it: lowercase, plus-tag and trailing digits dropped. */
export function mailboxOf(email: string): string {
  const at = email.lastIndexOf("@");
  const local = (at < 0 ? email : email.slice(0, at)).toLowerCase().split("+", 1)[0] as string;
  return plain(local.replace(/\d+$/, "")).replace(/ /g, ".");
}

/**
 * Every mailbox a firm would plausibly give this name: first, last, first.last,
 * firstlast, flast, f.last, firstl, first_last, first-last (separators read as
 * one). A compound last name counts joined and by its final word.
 */
export function mailboxForms(person: NamedPerson): Set<string> {
  const parsed = parseDirectName(person.fullName);
  const firstRaw = person.firstName?.trim() || parsed?.[1] || "";
  const lastRaw = person.lastName?.trim() || parsed?.[2] || "";
  const first = plain(firstRaw).split(" ")[0] ?? "";
  const lastWords = plain(lastRaw).split(" ").filter(Boolean);
  const lasts = new Set([lastWords.join(""), lastWords.at(-1) ?? ""].filter(Boolean));
  const forms = new Set<string>();
  if (first.length >= 2) forms.add(first);
  for (const last of lasts) {
    if (last.length >= 2) forms.add(last);
    if (!first) continue;
    forms.add(`${first}.${last}`);
    forms.add(`${first}${last}`);
    forms.add(`${first[0]}${last}`);
    forms.add(`${first[0]}.${last}`);
    forms.add(`${first}${last[0]}`);
  }
  return forms;
}

/** `_` and `-` read as `.`, so first_last and first-last are first.last. */
const fits = (mailbox: string, person: NamedPerson) => {
  const forms = mailboxForms(person);
  return forms.has(mailbox) || forms.has(mailbox.replace(/\./g, ""));
};

/**
 * Does the mailbox fit this person's name, or another person we hold at the
 * firm? Null for a role mailbox (info@): it fits nobody by design, so it skips.
 */
export function mailboxFitsName(
  email: string,
  person: NamedPerson | null,
  colleagues: readonly NamedPerson[],
): CheckOutcome | null {
  if (isRoleLocalpart(email)) return null;
  const mailbox = mailboxOf(email);
  const kind = "mailbox_fits_name";
  if (!mailbox) return outcome(kind, "unknown", { mailbox });
  const others = colleagues.filter((c) => c.id !== person?.id && fits(mailbox, c));
  if (person && fits(mailbox, person)) {
    // Two Janes at one firm: jane@ fits both, so it proves neither.
    return others.length
      ? outcome(kind, "unknown", { mailbox, also_fits: others.map((o) => o.id) })
      : outcome(kind, "pass", { mailbox });
  }
  const [other] = others;
  if (other)
    return outcome(kind, "fail", { mailbox, fits_person_id: other.id, fits: other.fullName });
  return outcome(kind, "unknown", { mailbox });
}

/** The address's registrable domain is the firm's own. */
export function domainIsFirm(email: string, firmDomain: string | null): CheckOutcome {
  const kind = "domain_is_firm";
  const at = email.lastIndexOf("@");
  const mail =
    at < 0
      ? ""
      : email
          .slice(at + 1)
          .trim()
          .toLowerCase();
  const firm = firmDomain ? extractDomain(firmDomain) : null;
  if (!mail || !firm)
    return outcome(kind, "unknown", { email_domain: mail || null, firm_domain: firm });
  const same = registrableDomain(mail) === registrableDomain(firm);
  return outcome(kind, same ? "pass" : "fail", { email_domain: mail, firm_domain: firm });
}

/** The newest lookup: still there passes; moved on, sure enough, fails. */
export function worksThere(newest: LookupFinding | null): CheckOutcome {
  const kind = "works_there";
  if (!newest) return outcome(kind, "unknown");
  const evidence = { finding_id: newest.id, finding: newest.kind, confidence: newest.confidence };
  if (newest.kind === "still_there") return outcome(kind, "pass", evidence);
  if (
    (newest.kind === "job_change" || newest.kind === "left") &&
    newest.confidence >= MOVED_ON_CONFIDENCE
  )
    return outcome(kind, "fail", { ...evidence, now_at: newest.value.to ?? null });
  return outcome(kind, "unknown", evidence);
}

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "co",
  "for",
  "in",
  "of",
  "the",
  "to",
  "sr",
  "jr",
  "senior",
  "junior",
]);
const titleWords = (t: string) =>
  new Set(
    plain(t)
      .split(" ")
      .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w)),
  );

/** Info only: the profile's title at the firm shares a word with ours. */
export function titleAgrees(heldTitle: string | null, newest: LookupFinding | null): CheckOutcome {
  const kind = "title_agrees";
  const seen = newest?.kind === "still_there" ? newest.value.title : null;
  if (!heldTitle?.trim() || typeof seen !== "string" || !seen.trim())
    return outcome(kind, "unknown", { held: heldTitle ?? null, profile: seen ?? null });
  const held = titleWords(heldTitle);
  const shared = [...titleWords(seen)].filter((w) => held.has(w));
  return outcome(kind, shared.length ? "pass" : "fail", { held: heldTitle, profile: seen, shared });
}

/** The firm's LinkedIn page names the firm's own site. No page after a finished lookup fails. */
export function pageIsFirm(
  page: CompanyPage | null,
  firmDomain: string | null,
  lookupState: string | null,
): CheckOutcome {
  const kind = "page_is_firm";
  if (!page)
    return outcome(kind, lookupState === "unresolved" ? "fail" : "unknown", {
      lookup: lookupState,
    });
  const homepage = typeof page.value.homepage === "string" ? page.value.homepage : null;
  if (!firmDomain) return outcome(kind, "unknown", { finding_id: page.id, homepage });
  return outcome(kind, firmSite(homepage, firmDomain) ? "pass" : "fail", {
    finding_id: page.id,
    homepage,
    firm_domain: firmDomain,
  });
}

/** Last ten digits: a country code or a leading 1 never decides it. */
const phoneKey = (p: unknown) => {
  if (typeof p !== "string") return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

/** Info only: the page's phone is the import's phone. */
export function phoneAgrees(page: CompanyPage | null, importPhone: unknown): CheckOutcome {
  const kind = "phone_agrees";
  const seen = phoneKey(page?.value.phone);
  const held = phoneKey(importPhone);
  if (!seen || !held) return outcome(kind, "unknown", { page: seen, import: held });
  return outcome(kind, seen === held ? "pass" : "fail", { page: seen, import: held });
}

export interface LeadCheckInput {
  readonly email: string;
  readonly firmDomain: string | null;
  /** The lead's person (its newest candidate's), or null. */
  readonly person: (NamedPerson & { readonly title: string | null }) | null;
  /** Everyone we hold at the firm, the person included or not. */
  readonly colleagues: readonly NamedPerson[];
  readonly lookup: LookupFinding | null;
  readonly page: CompanyPage | null;
  readonly companyLookupState: string | null;
  readonly importPhone: unknown;
}

/** All six checks for one lead; a role mailbox has no `mailbox_fits_name`. */
export function checkLead(input: LeadCheckInput): CheckOutcome[] {
  const fitsName = mailboxFitsName(input.email, input.person, input.colleagues);
  return [
    ...(fitsName ? [fitsName] : []),
    domainIsFirm(input.email, input.firmDomain),
    input.person ? worksThere(input.lookup) : outcome("works_there", "unknown", { person: null }),
    titleAgrees(input.person?.title ?? null, input.person ? input.lookup : null),
    pageIsFirm(input.page, input.firmDomain, input.companyLookupState),
    phoneAgrees(input.page, input.importPhone),
  ];
}

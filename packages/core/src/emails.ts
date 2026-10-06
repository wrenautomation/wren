/**
 * Shared email-address knowledge: normalization, pragmatic syntax rules, domain
 * extraction, freemail / platform / role lists. Ingestion and verification both
 * need these. Rules are pragmatic, not full RFC 5321: addresses that need quoting
 * don't survive real B2B mail anyway.
 */

import freeEmailDomains from "free-email-domains";
import { getDomain } from "tldts";

/**
 * Providers where the email domain identifies a person, not a business. Never keys a company.
 * HubSpot's list (free-email-domains) plus the ISP mailboxes it lacks.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  ...freeEmailDomains,
  "centurylink.net",
  "gpcom.net",
  "midconetwork.com",
  "optimum.net",
  "suddenlink.net",
]);

/**
 * Platforms whose URLs point at a profile on someone else's service. Suffix-matched
 * (uk.linkedin.com counts). Where the parent is a real business (apple.com,
 * spotify.com) only the hosted-content subdomain is listed. Niche-specific listing
 * hosts (clutch.co) are passed by the caller as `extra`.
 */
export const PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "threads.net",
  "pinterest.com",
  "yelp.com",
  "medium.com",
  "substack.com",
  "linktr.ee",
  "calendly.com",
  "crunchbase.com",
  "google.com",
  "bit.ly",
  "goo.gl",
  "vimeo.com",
  "open.spotify.com",
  "podcasts.apple.com",
  "podbean.com",
  "soundcloud.com",
  "anchor.fm",
  "buzzsprout.com",
  "libsyn.com",
  "spreaker.com",
  // Job boards and applicant-tracking hosts: a firm's job page there is not its site.
  "icims.com",
  "myworkdayjobs.com",
  "lever.co",
  "taleo.net",
  "recruiterbox.com",
  "zohorecruit.com",
  "applicantpool.com",
  "bamboohr.com",
  "crelate.com",
  "laboredge.com",
  "staffingreferrals.com",
  "securedportals.com",
  "applytojob.com",
  "jobvite.com",
  "greenhouse.io",
  "workable.com",
  "breezy.hr",
  "paylocity.com",
  "ultipro.com",
  "workforcenow.adp.com",
  "ziprecruiter.com",
  "indeed.com",
  "glassdoor.com",
  "careerbuilder.com",
  "jobs.net",
  "monster.com",
  "simplyhired.com",
  "expertini.com",
  "hotfrog.com",
  "hotfrog.ca",
]);

/** Functional mailboxes (info@, hello@): a role, not a person. One vocabulary for every consumer. */
export const ROLE_LOCALPARTS: ReadonlySet<string> = new Set([
  "abuse",
  "admin",
  "administrator",
  "billing",
  "contact",
  "help",
  "hello",
  "hr",
  "info",
  "jobs",
  "mail",
  "marketing",
  "no-reply",
  "noreply",
  "office",
  "postmaster",
  "privacy",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// IDN labels arrive punycode-encoded ("xn--mnchen-3ya" = münchen).
const PUNYCODE_RE = /^xn--[a-z0-9-]+$/;

export function normalizeEmail(raw: string): string {
  let email = raw.trim().toLowerCase();
  if (email.startsWith("mailto:")) email = email.slice("mailto:".length);
  return email.replace(/^[<>]+|[<>]+$/g, "").trim();
}

/** Reason the (already normalized) address is undeliverable, or null. */
export function emailSyntaxError(email: string): string | null {
  const parts = email.split("@");
  if (parts.length !== 2) return "must contain exactly one @";
  const [local, domain] = parts as [string, string];
  if (!local) return "empty local part";
  if (local.length > 64) return "local part longer than 64 chars";
  if (email.length > 254) return "address longer than 254 chars";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "misplaced dot in local part";
  }
  if (!LOCAL_RE.test(local)) return "illegal character in local part";
  if (!validDomain(domain)) return "invalid domain";
  return null;
}

export function validDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  const labels = domain.replace(/\.+$/, "").split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL_RE.test(l) || PUNYCODE_RE.test(l))) return false;
  const tld = labels[labels.length - 1] as string;
  return tld.length >= 2 && (/^[a-z]+$/.test(tld) || PUNYCODE_RE.test(tld));
}

/** Registrable-ish domain from whatever a scraped "website" column holds, or null. */
export function extractDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  const scheme = s.indexOf("://");
  if (scheme >= 0) s = s.slice(scheme + 3);
  for (const sep of ["/", "?", "#", "\\"]) s = s.split(sep, 1)[0] as string;
  s = s.slice(s.lastIndexOf("@") + 1); // user@host URL forms
  s = s.split(":", 1)[0] as string; // port
  if (s.startsWith("www.")) s = s.slice(4);
  s = s.replace(/[.,;]+$/, ""); // trailing punctuation from glued URL lists
  return validDomain(s) ? s : null;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase());
}

const suffixMatch = (d: string, set: Iterable<string>) => {
  for (const p of set) if (d === p || d.endsWith(`.${p}`)) return true;
  return false;
};

/** True when the domain identifies a hosting platform, not a business. */
export function isPlatformDomain(domain: string, extra: Iterable<string> = []): boolean {
  const d = domain.toLowerCase();
  return suffixMatch(d, PLATFORM_DOMAINS) || suffixMatch(d, extra);
}

/**
 * Site builders that hand each customer a subdomain, beyond the public suffix list's
 * own (blogspot.com, wixsite.com, square.site are already there): each subdomain is a
 * different business, so none of them groups with another.
 */
export const SITE_BUILDER_HOSTS: ReadonlySet<string> = new Set([
  "business.site",
  "wix.com",
  "weebly.com",
  "godaddysites.com",
  "ueniweb.com",
  "hub.biz",
  "placeweb.site",
  "wordpress.com",
  "squarespace.com",
  "webflow.io",
  "carrd.co",
  "jimdosite.com",
  "mystrikingly.com",
  "site123.me",
  "yolasite.com",
  "webs.com",
  "homestead.com",
]);

/**
 * The domain its owner registered: `locations.acme.com` → `acme.com`, `acme.on.ca`
 * stays whole, and one site on a builder (`acme.business.site`) is its own.
 */
export function registrableDomain(domain: string): string {
  const d = domain.toLowerCase().replace(/\.+$/, "");
  for (const host of SITE_BUILDER_HOSTS) {
    if (!d.endsWith(`.${host}`)) continue;
    const label = d
      .slice(0, -host.length - 1)
      .split(".")
      .pop() as string;
    return `${label}.${host}`;
  }
  return getDomain(d, { allowPrivateDomains: true }) ?? d;
}

/** True for a functional mailbox by its local part alone; plus-tags stripped. A bare word is never an address. */
export function isRoleLocalpart(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 0) return false;
  const local = email.slice(0, at).trim().toLowerCase();
  return ROLE_LOCALPARTS.has(local.split("+", 1)[0] as string);
}

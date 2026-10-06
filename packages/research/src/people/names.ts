/**
 * Is this the same person, the same firm? The match rule (R7) is name plus a
 * past employer or the email domain, so both halves must be strict: a miss
 * leaves a contact unresolved, a false hit cites a stranger.
 */

import { parseName } from "@wren/core";
import { getDomainWithoutSuffix } from "tldts";

/** Lowercase letters and digits, accents and apostrophes dropped (O'Brien = OBrien), everything else one space. */
export const plain = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const tokens = (s: string) => plain(s).split(" ").filter(Boolean);

export interface NameParts {
  firstName: string | null;
  lastName: string | null;
}

/**
 * A name as a platform shows it ("Jane (Smith) Doe, MBA", "Dr. Jane Doe 🚀",
 * "Doe, Jane") against the one we hold. The given name comes first and must be
 * ours, or a short form of it (Chris, Christopher: 3+ letters apart, so Eric
 * is not Erica); every last-name word must come after it. Order matters:
 * "Taylor Johnson" is not John Taylor. A name we hold without both halves
 * never matches: one word is too many strangers.
 */
export function sameName(want: NameParts, seen: string): boolean {
  if (!want.firstName || !want.lastName) return false;
  const parsed = parseName(seen.replace(/\([^)]*\)/g, " "));
  const got = parsed ? tokens(parsed[0]) : [];
  const given = tokens(parsed?.[1] ?? "")[0];
  const first = tokens(want.firstName)[0];
  const last = tokens(want.lastName);
  if (!given || !first || !last.length || !sameGiven(first, given)) return false;
  const after = got.slice(got.indexOf(given) + 1);
  return last.every((w) => after.includes(w));
}

const sameGiven = (a: string, b: string): boolean => {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.length - short.length >= 3 && long.startsWith(short);
};

/** Words a firm's name carries that say nothing about which firm. */
const LEGAL = new Set([
  "the",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "pty",
]);

/**
 * "The Acme Group, Inc." -> "acme group". Legal words go only from the end
 * (and "the" from the front), so "SA Recruiting" keeps its SA.
 */
export const companyPhrase = (name: string): string => {
  const w = tokens(name);
  if (w[0] === "the") w.shift();
  while (w.length && LEGAL.has(w.at(-1) ?? "")) w.pop();
  return w.join(" ");
};

/**
 * "acme-staffing.co.uk" -> "acme staffing", "careers.ibm.com" -> "ibm": the registrable
 * label, as words, by the public suffix list (private suffixes too: acme.myshopify.com is acme).
 */
export const domainLabel = (domain: string): string =>
  plain(getDomainWithoutSuffix(domain.replace(/\.+$/, ""), { allowPrivateDomains: true }) ?? "");

/**
 * One firm under two spellings: equal after legal words go, equal with the
 * spaces gone ("HireRight", "Hire Right"), or one the other's first or last
 * words ("Acme" at "Acme Staffing Group", "Disney" at "The Walt Disney
 * Company") when the shorter has a word of 4+ letters.
 */
export function sameCompany(a: string, b: string): boolean {
  const pa = companyPhrase(a);
  const pb = companyPhrase(b);
  if (!pa || !pb) return false;
  if (pa === pb || pa.replace(/ /g, "") === pb.replace(/ /g, "")) return true;
  const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return (
    (long.startsWith(`${short} `) || long.endsWith(` ${short}`)) &&
    short.split(" ").some((w) => w.length >= 4)
  );
}

export interface Firm {
  name: string | null;
  domain: string | null;
}

/** The firm's names worth looking for: its own, and its domain's label when that is a real word. */
export const firmNames = (firm: Firm): string[] => {
  const label = firm.domain ? domainLabel(firm.domain) : "";
  return [firm.name ?? "", label.replace(/ /g, "").length >= 4 ? label : ""].filter(
    (n) => companyPhrase(n).length >= 3,
  );
};

/** "The Globex Corporation, Inc." -> "Globex": the name as written, legal words gone. */
export function bareCompanyName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const legal = (w: string) => !plain(w) || LEGAL.has(plain(w));
  if (words.length > 1 && plain(words[0] ?? "") === "the") words.shift();
  while (words.length > 1 && legal(words.at(-1) ?? "")) words.pop();
  return words.join(" ").replace(/[\s,.;:&-]+$/, "");
}

/** An address or a bare domain in running text. */
const DOMAINISH = /[\w.+-]*@?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;

/** The domain itself, not inside another one: acme.co is not in acme.com or goacme.co. */
const namesDomain = (text: string, domain: string): boolean => {
  const d = domain
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9-])${d}(?![a-z0-9-]|\\.[a-z0-9])`, "i").test(text);
};

/**
 * Does this text name the firm: its phrase as whole words, or its domain?
 * `except` are phrases blanked out first, such as the person's own name, so
 * Jane Doe does not name "Doe LLC" by being Jane Doe.
 */
export function mentionsFirm(text: string, firm: Firm, except: string[] = []): boolean {
  if (firm.domain && namesDomain(text, firm.domain)) return true;
  // Other domains and addresses name other firms: jane@acme.com is not "Acme" at acme.co.
  let hay = ` ${plain(text.replace(DOMAINISH, " | "))} `;
  // plain() leaves letters, digits and spaces only: safe inside a pattern.
  for (const e of except.map(plain).filter(Boolean))
    hay = hay.replace(new RegExp(`(?<= )${e}(?= )`, "gu"), "|");
  return firmNames(firm).some((n) => hay.includes(` ${companyPhrase(n)} `));
}

/**
 * Is `name` this firm: the same company as its name, or its domain's label
 * spaces aside ("Acme Staffing" at acmestaffing.com, "Acme" at acmestaffing.com).
 * A longer name that only starts with the label is someone else: "Northside
 * Hospital" is not Northside Talent at northside.com.
 */
export function isFirm(name: string, firm: Firm): boolean {
  if (firm.name && companyPhrase(firm.name).length >= 2 && sameCompany(name, firm.name))
    return true;
  const label = firm.domain ? domainLabel(firm.domain).replace(/ /g, "") : "";
  const said = companyPhrase(name).replace(/ /g, "");
  if (label.length < 4 || !said) return false;
  return said === label || (said.length >= 4 && label.startsWith(said));
}

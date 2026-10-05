/**
 * Each mail domain's standing, for the morning digest: is it on a domain blocklist
 * (Spamhaus DBL, SURBL, URIBL), does its DNS carry what mail needs (one SPF, DKIM,
 * DMARC, MX), are fleet domains still on Route 53, and is an SMTP sender's host IP on
 * the prober check's IP lists. A listing or a failed check is a warning.
 *
 * Each list refuses big shared resolvers with its own answer (DBL 127.255.255.x,
 * SURBL and URIBL 127.0.0.1); a refused or failed lookup reads "not checked", never
 * "clear". Every lookup has its own timeout, so a slow list cannot stall the digest.
 */
import { promises as dns } from "node:dns";
import type { Mailboxes } from "../send/mailboxes.js";
import { type Sender, senderDomain } from "../send/roster.js";
import { ipStanding, type Resolver } from "./prober-health.js";

export const DOMAIN_LISTS = {
  dbl: "dbl.spamhaus.org",
  surbl: "multi.surbl.org",
  uribl: "multi.uribl.com",
} as const;
export type DomainList = keyof typeof DOMAIN_LISTS;
const LIST_NAMES = Object.keys(DOMAIN_LISTS) as DomainList[];
export type ListStanding = "listed" | "clear" | "not checked";

/** One try per lookup, then it reads as failed. */
export const LOOKUP_TIMEOUT_MS = 3000;
const bounded = () => new dns.Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });

export interface DomainResolver extends Resolver {
  resolveNs(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(host: string): Promise<string[][]>;
}

/** One domain to check, as the composition root lists it. */
export interface DomainTarget {
  domain: string;
  /** Bought for sending: its NS must be Route 53 (awsdns). Otherwise the NS set is only reported. */
  fleet: boolean;
  /** Where its DKIM key lives (`google` for Google senders); null skips the check. */
  dkimSelector: string | null;
  /** An SMTP sender's host, whose IP goes through the prober's IP lists. */
  smtpHost: string | null;
}

export interface DomainStanding {
  domain: string;
  fleet: boolean;
  lists: Record<DomainList, ListStanding>;
  ns: string[];
  mx: number;
  /** `v=spf1` TXT records at the apex; exactly one is valid. */
  spf: number;
  /** `v=DMARC1` TXT records at `_dmarc`; exactly one is valid. */
  dmarc: number;
  dkim: { selector: string; found: boolean } | null;
  smtp: { host: string; ip: string | null; listed: string[] } | null;
}

/** What one A answer from `list` means: a listing, a refused lookup, or nothing. */
export function readListAnswer(list: DomainList, answer: string): "listed" | "refused" | null {
  const [a, b, c, d = 0] = answer.split(".").map(Number);
  if (a !== 127) return null;
  if (list === "dbl") {
    if (b === 255 && c === 255) return "refused";
    return b === 0 && c === 1 && d >= 2 ? "listed" : null;
  }
  if (b !== 0 || c !== 0) return null;
  if (d === 1) return "refused";
  return list === "surbl" || (d & 14) !== 0 ? "listed" : null;
}

/** A lookup's records: [] when the name has none, null when the lookup itself failed. */
async function ask<T>(lookup: Promise<T[]>): Promise<T[] | null> {
  try {
    return await lookup;
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? [] : null;
  }
}

async function listStanding(
  list: DomainList,
  domain: string,
  resolver: DomainResolver,
): Promise<ListStanding> {
  const answers = await ask(resolver.resolve4(`${domain}.${DOMAIN_LISTS[list]}`));
  const read = (answers ?? []).map((a) => readListAnswer(list, a));
  if (read.includes("listed")) return "listed";
  return answers === null || read.includes("refused") ? "not checked" : "clear";
}

const txt = async (host: string, resolver: DomainResolver): Promise<string[]> =>
  ((await ask(resolver.resolveTxt(host))) ?? []).map((chunks) => chunks.join(""));

export async function domainStanding(
  target: DomainTarget,
  resolver: DomainResolver = bounded(),
): Promise<DomainStanding> {
  const { domain, dkimSelector, smtpHost } = target;
  const [lists, ns, mx, apex, dmarc, dkim, smtp] = await Promise.all([
    Promise.all(LIST_NAMES.map((l) => listStanding(l, domain, resolver))),
    ask(resolver.resolveNs(domain)),
    ask(resolver.resolveMx(domain)),
    txt(domain, resolver),
    txt(`_dmarc.${domain}`, resolver),
    dkimSelector ? txt(`${dkimSelector}._domainkey.${domain}`, resolver) : [],
    smtpHost ? ipStanding(smtpHost, resolver) : null,
  ]);
  return {
    domain,
    fleet: target.fleet,
    lists: Object.fromEntries(LIST_NAMES.map((l, i) => [l, lists[i]])) as DomainStanding["lists"],
    ns: (ns ?? []).map((n) => n.toLowerCase().replace(/\.$/, "")).sort(),
    mx: mx?.length ?? 0,
    spf: apex.filter((t) => /^v=spf1(\s|$)/i.test(t)).length,
    dmarc: dmarc.filter((t) => t.startsWith("v=DMARC1")).length,
    dkim: dkimSelector
      ? { selector: dkimSelector, found: dkim.some((t) => t.startsWith("v=DKIM1")) }
      : null,
    smtp: smtpHost && smtp ? { host: smtpHost, ip: smtp.ip, listed: smtp.listed } : null,
  };
}

/** Every target at once, sharing one resolver. */
export function domainStandings(
  targets: readonly DomainTarget[],
  resolver: DomainResolver = bounded(),
): Promise<DomainStanding[]> {
  return Promise.all(targets.map((t) => domainStanding(t, resolver)));
}

const onRoute53 = (ns: readonly string[]) => ns.length > 0 && ns.every((n) => n.includes("awsdns"));

type Check = [name: string, ok: boolean, why: string];

/** The DNS checks in digest order. */
function dnsChecks(h: DomainStanding): Check[] {
  const checks: Check[] = [["spf", h.spf === 1, `${h.domain} has ${h.spf} SPF records, not one`]];
  if (h.dkim)
    checks.push([
      "dkim",
      h.dkim.found,
      `${h.domain} has no DKIM key at ${h.dkim.selector}._domainkey`,
    ]);
  checks.push(
    ["dmarc", h.dmarc === 1, `${h.domain} has ${h.dmarc} DMARC records, not one`],
    ["mx", h.mx > 0, `${h.domain} has no MX`],
  );
  return checks;
}

/** What is wrong with one domain, empty when nothing is. A list that was not checked is not a problem. */
export function domainProblems(h: DomainStanding): string[] {
  const problems: string[] = [];
  const listed = LIST_NAMES.filter((l) => h.lists[l] === "listed");
  if (listed.length > 0)
    problems.push(`${h.domain} listed on ${listed.map((l) => DOMAIN_LISTS[l]).join(", ")}`);
  if (h.fleet && !onRoute53(h.ns))
    problems.push(`${h.domain} NS is ${h.ns.join(", ") || "missing"}, not Route 53`);
  problems.push(...dnsChecks(h).flatMap(([, ok, why]) => (ok ? [] : [why])));
  if (h.smtp && !h.smtp.ip) problems.push(`SMTP host ${h.smtp.host} does not resolve`);
  if (h.smtp?.ip && h.smtp.listed.length > 0)
    problems.push(`${h.smtp.ip} (${h.smtp.host}) listed on ${h.smtp.listed.join(", ")}`);
  return problems;
}

/** Domain names a signature's text mentions (`wrenautomation.com{page}`, an address), lowercased. */
export const namedDomains = (text: string): string[] => [
  ...new Set((text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []).map((d) => d.toLowerCase())),
];

/**
 * The mail domains to watch: every sending domain, then the main site and any other
 * domain a signature names. A domain with a ramped inbox was bought for sending, so it
 * must sit on Route 53; DKIM is at the roster's selector, else `google`.
 */
export function mailDomainTargets(
  roster: readonly Sender[],
  mailboxes: Mailboxes,
  siteBaseUrl: string,
): DomainTarget[] {
  const sending = [...new Set(roster.map((s) => senderDomain(s)))];
  const sites = new Set([
    new URL(siteBaseUrl).hostname,
    ...roster.flatMap((s) => namedDomains(s.signature?.text ?? "")),
  ]);
  return [
    ...sending.map((domain) => {
      const on = roster.filter((s) => senderDomain(s) === domain);
      const smtp = on.find((s) => s.transport === "smtp");
      return {
        domain,
        fleet: on.some((s) => s.ramp !== null),
        dkimSelector: on.find((s) => s.dkim)?.dkim ?? "google",
        smtpHost: smtp ? (mailboxes.get(smtp.address)?.smtp.host ?? null) : null,
      };
    }),
    ...[...sites]
      .filter((d) => !sending.includes(d))
      .map((domain) => ({ domain, fleet: false, dkimSelector: null, smtpHost: null })),
  ];
}

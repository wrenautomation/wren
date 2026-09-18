/** URL judgments shared by the crawl and render tiers. */

/** Path/anchor vocabulary marking people-content: GENERIC words only; a niche's own site vocabulary arrives through its crawl hints. */
export const PEOPLE_PAGE_HINTS: readonly string[] = [
  "team",
  "about",
  "people",
  "staff",
  "leadership",
  "who-we-are",
  "whoweare",
  "bios",
  "bio",
  "founder",
  "contact",
];

/**
 * null for hrefs no parser should trust: real sites link things like
 * `https://site.com:+1(832)384-8118` (a phone number in the port slot).
 */
export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function sameHost(url: string, domain: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host === domain || host === `www.${domain}`;
}

export function looksLikePeoplePage(
  url: string,
  anchor: string,
  hints: readonly string[],
): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const path = parsed.pathname.toLowerCase();
  const text = anchor.toLowerCase();
  return hints.some((hint) => path.includes(hint) || text.includes(hint));
}

/** Same-host people-page links from a homepage, hash-stripped and deduped, in page order. */
export function peoplePageCandidates(
  links: ReadonlyArray<{ url: string; anchor: string }>,
  domain: string,
  hints: readonly string[],
): string[] {
  const out: string[] = [];
  for (const { url, anchor } of links) {
    const clean = url.split("#", 1)[0] as string;
    if (!sameHost(clean, domain) || out.includes(clean)) continue;
    if (looksLikePeoplePage(clean, anchor, hints)) out.push(clean);
  }
  return out;
}

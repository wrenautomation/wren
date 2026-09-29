/**
 * One firm's own site from its name, with no database: a stated site first,
 * then the name's guessed domains. Either way the page must speak for the
 * firm (the ownership gate) before it counts.
 */
import { decodeEntities } from "../fetch/htmltext.js";
import { domainCandidates } from "./candidates.js";
import { type GateEvidence, gatePage } from "./gate.js";
import { dohResolves, type HomepageFetcher, type Resolves } from "./service.js";

export interface FoundHomepage {
  domain: string;
  /** "stated": the site we were given; "guessed": from the name. */
  how: "stated" | "guessed";
  evidence: GateEvidence;
}

export interface FindHomepageDeps {
  fetchHomepage: HomepageFetcher;
  resolves?: Resolves;
  genericWords?: ReadonlySet<string>;
}

const domainOf = (site: string): string | null => {
  try {
    return new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
};

export async function findHomepage(
  name: string,
  stated: string | null,
  deps: FindHomepageDeps,
): Promise<FoundHomepage | null> {
  const resolves = deps.resolves ?? dohResolves;
  const genericWords = deps.genericWords ?? new Set<string>();
  const tries: { domain: string; how: FoundHomepage["how"] }[] = [];
  const given = stated ? domainOf(stated) : null;
  if (given) tries.push({ domain: given, how: "stated" });
  for (const d of domainCandidates(name, { genericWords }))
    if (d !== given) tries.push({ domain: d, how: "guessed" });
  for (const t of tries) {
    // A stated site skips DNS: the fetch says as much, and costs no more.
    if (t.how === "guessed" && !(await resolves(t.domain))) continue;
    const page = await deps.fetchHomepage(t.domain);
    if (!page) continue;
    const evidence = gatePage({
      url: page.url,
      pageTitle: page.title,
      pageText: page.text,
      companyName: name,
      sourceKey: null,
      genericWords,
    });
    if (evidence) return { domain: t.domain, how: t.how, evidence };
  }
  return null;
}

/**
 * A firm's name from its home page: the site name it declares, else the title
 * part that matches its domain ("Acme | Recruiting" on acme.com), else null.
 * A tagline title ("Recruiting for Startups") names nobody.
 */
export function siteName(html: string, domain: string): string | null {
  const meta = html.match(
    /<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og:site_name|application-name)["'][^>]*>/i,
  )?.[0];
  const declared = decodeEntities(
    meta?.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? "",
  ).trim();
  if (declared) return declared;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const label = squash(domain.replace(/^www\./, "").split(".")[0] ?? "");
  if (!label) return null;
  const title = decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  const parts = title.split(/\s+[|–—-]\s+|\s*[|:·]\s*/).map((p) => p.trim());
  return (
    parts.find((p) => {
      const q = squash(p);
      return q.length > 1 && (label.includes(q) || q.includes(label));
    }) ?? null
  );
}

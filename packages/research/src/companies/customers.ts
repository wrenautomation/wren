/**
 * The companies a firm's own site names as its customers: logo walls, case
 * studies, testimonials. The model reads the pages; a name counts only when
 * the pages carry it themselves (in the text, an image's alt or file name, or
 * a link), so a name the model made up never gets through.
 */
import { completeAndParse, type LlmClient } from "@wren/llm";
import { z } from "zod";
import { FetchError, type Fetcher } from "../fetch/fetcher.js";
import { decodeEntities, readPage } from "../fetch/htmltext.js";
import { canFetch, type RobotsCache } from "../fetch/robots.js";
import { companyPhrase, isFirm, mentionsFirm } from "../people/names.js";

export const CUSTOMERS_STAGE = "research_customers";
/** Pages read besides the home page. */
const MAX_PAGES = 8;
/** Characters of page text per page the model sees. */
const TEXT_CAP = 6_000;
const MAX_TOKENS = 3_000;

/** Links worth following: where a firm shows who it worked for. */
const CUSTOMER_PAGE =
  /client|customer|case[\s_-]?stud|testimonial|our[\s_-]?work|portfolio|success|results|who[\s_-]?we[\s_-]?(serve|work|help)|industr|partner|review/i;

export interface NamedCustomer {
  name: string;
  /** The customer's site when a link on the pages points there; null otherwise. */
  website: string | null;
  /** The page that named it. */
  seenOn: string;
}

export interface CustomersTried {
  url: string;
  outcome: string;
}

export interface CustomersResult {
  customers: NamedCustomer[];
  /** Names the model gave that the pages don't carry, or that are the firm itself. */
  dropped: { name: string; why: string }[];
  tried: CustomersTried[];
}

export interface CustomersOptions {
  maxPages?: number;
  runId?: string | null;
}

/** What one page offers the model: its words, its images' names, its outbound links. */
interface PageMaterial {
  url: string;
  text: string;
  images: string[];
  links: { url: string; anchor: string }[];
}

const customersSchema = z.object({
  customers: z.array(
    z.object({
      name: z.string(),
      website: z.string().nullable().optional(),
      page: z.string().nullable().optional(),
    }),
  ),
});

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Image alt and title text, and file names ("acme-corp-logo.png" -> "acme corp logo"). */
export function imageNames(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    for (const attr of ["alt", "title"]) {
      const m = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
      const v = decodeEntities(m?.[1] ?? m?.[2] ?? "").trim();
      if (v) out.push(v);
    }
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const file = (src?.[1] ?? src?.[2] ?? "").split(/[?#]/)[0]?.split("/").at(-1) ?? "";
    const stem = file
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_.]+/g, " ")
      .trim();
    // Hashes and sizes name nothing: "a8f3c2e1", "1200x630".
    if (/[a-z]{3}/i.test(stem) && !/^[0-9a-f\s]{8,}$/i.test(stem)) out.push(stem);
  }
  return [...new Set(out)];
}

export function buildCustomersPrompt(firm: string, pages: PageMaterial[]): string {
  const blocks = pages.map((p) =>
    [
      `=== PAGE ${p.url}`,
      p.text.slice(0, TEXT_CAP),
      p.images.length ? `IMAGES: ${p.images.join(" | ")}` : "",
      p.links.length
        ? `LINKS OFF THE SITE:\n${p.links.map((l) => `- ${l.url} (${l.anchor || "no text"})`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `These are pages from ${firm}'s own website.`,
    `List the companies the pages name as ${firm}'s customers or clients: logos under "our clients" or "trusted by", case studies, testimonials from a named company.`,
    'Leave out: the firm itself, tools and vendors it uses, awards, press ("as seen in"), associations, certifications, job boards, and any company named only as someone\'s past employer.',
    "Write each name as the page writes it. website: the link off the site that points to that company, or null. page: the page url it was on.",
    'Return JSON only: {"customers": [{"name": "...", "website": null, "page": "..."}]}. An empty list is a fine answer.',
    "",
    ...blocks,
  ].join("\n");
}

async function fetchPage(
  fetcher: Fetcher,
  url: string,
  robots: RobotsCache,
): Promise<{ url: string; html: string } | string> {
  if (!(await canFetch(fetcher, url, robots))) return "robots.txt disallows";
  try {
    const r = await fetcher.get(url);
    if (r.status >= 400) return `HTTP ${r.status}`;
    return { url: r.url, html: r.text };
  } catch (err) {
    if (err instanceof FetchError) return "unreachable";
    throw err;
  }
}

/**
 * The customers `site` names. Reads the home page and the pages it links to
 * that look like client lists; one model call over all of them.
 */
export async function findCustomers(
  fetcher: Fetcher,
  llm: LlmClient,
  firm: { name: string; site: string },
  opts: CustomersOptions = {},
): Promise<CustomersResult> {
  const tried: CustomersTried[] = [];
  const robots: RobotsCache = new Map();
  const root = /^https?:\/\//i.test(firm.site) ? firm.site : `https://${firm.site}`;
  const home = await fetchPage(fetcher, root, robots);
  if (typeof home === "string") {
    tried.push({ url: root, outcome: home });
    return { customers: [], dropped: [], tried };
  }
  const siteHost = hostOf(home.url);
  const onSite = (u: string) => hostOf(u) === siteHost;

  const material = (url: string, html: string): PageMaterial => {
    const page = readPage(html, url);
    return {
      url,
      text: page.text,
      images: imageNames(html),
      links: page.links.filter(
        (l) =>
          /^https?:/i.test(l.url) &&
          !onSite(l.url) &&
          !/linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok/i.test(l.url),
      ),
    };
  };
  const pages: PageMaterial[] = [material(home.url, home.html)];
  tried.push({ url: home.url, outcome: "read" });

  const next = readPage(home.html, home.url)
    .links.filter(
      (l) => onSite(l.url) && CUSTOMER_PAGE.test(`${new URL(l.url).pathname} ${l.anchor}`),
    )
    .map((l) => l.url.split("#")[0] ?? l.url);
  for (const url of [...new Set(next)]
    .filter((u) => u !== home.url)
    .slice(0, opts.maxPages ?? MAX_PAGES)) {
    const got = await fetchPage(fetcher, url, robots);
    if (typeof got === "string") {
      tried.push({ url, outcome: got });
      continue;
    }
    pages.push(material(got.url, got.html));
    tried.push({ url: got.url, outcome: "read" });
  }

  const outcome = await completeAndParse(
    llm,
    buildCustomersPrompt(firm.name, pages),
    customersSchema,
    {
      maxTokens: MAX_TOKENS,
      runId: opts.runId ?? null,
      name: CUSTOMERS_STAGE,
      metadata: { site: siteHost },
    },
  );
  if (!outcome.parsed) {
    tried.push({ url: "-", outcome: "the model's answer did not parse" });
    return { customers: [], dropped: [], tried };
  }
  return { ...gateCustomers(outcome.parsed.customers, firm, pages), tried };
}

/**
 * Keep what the pages carry: the name in a page's text, an image name or a
 * link. The website only when a link on the pages points there. One entry per
 * company, first spelling wins.
 */
export function gateCustomers(
  said: z.infer<typeof customersSchema>["customers"],
  firm: { name: string; site: string },
  pages: PageMaterial[],
): Omit<CustomersResult, "tried"> {
  const own = {
    name: firm.name,
    domain: hostOf(/^https?:/i.test(firm.site) ? firm.site : `https://${firm.site}`),
  };
  const outbound = new Map(
    pages.flatMap((p) => p.links.map((l) => [hostOf(l.url) ?? "", l.url] as const)),
  );
  const customers: NamedCustomer[] = [];
  const dropped: CustomersResult["dropped"] = [];
  const seen = new Set<string>();
  for (const c of said) {
    const name = c.name.trim();
    const phrase = companyPhrase(name);
    if (!phrase) continue;
    if (isFirm(name, own)) {
      dropped.push({ name, why: "the firm itself" });
      continue;
    }
    if (seen.has(phrase)) continue;
    const host = c.website
      ? hostOf(/^https?:/i.test(c.website) ? c.website : `https://${c.website}`)
      : null;
    const website = host && outbound.has(host) ? (outbound.get(host) ?? null) : null;
    const who = { name, domain: website ? host : null };
    const page = pages.find((p) =>
      mentionsFirm(
        [p.text, ...p.images, ...p.links.map((l) => `${l.anchor} ${l.url}`)].join("\n"),
        who,
      ),
    );
    if (!page) {
      dropped.push({ name, why: "not on the pages" });
      continue;
    }
    seen.add(phrase);
    customers.push({ name, website, seenOn: page.url });
  }
  return { customers, dropped };
}

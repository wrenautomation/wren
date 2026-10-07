/**
 * autobrowse's Exa-backed `web` routes on a client's own Exa key (designs/2026-10-07-vendor-keys.md):
 * people search, a firm's companies, company search, and LinkedIn profiles, company pages and
 * posts from Exa's index. Each answers in the shape autobrowse's route does
 * (`autobrowse/src/reach/web.ts`), so a caller can't tell which key ran. LinkedIn itself is never
 * reached: Exa's copy only (`livecrawl: never`), 404 when it holds none.
 */

import type { FetchLike } from "./doh.js";
import type { DirectAnswer } from "./vendor-direct.js";

/** Exa-backed `web` routes, by path. */
export const EXA_ROUTES = new Set([
  "/people",
  "/companies",
  "/exa/companies",
  "/linkedin/profile",
  "/linkedin/company",
  "/linkedin/posts",
]);

/** A miss the route answers as autobrowse does: a status and a message, never retried. */
class Miss extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LI = "https://www.linkedin.com";
const PAGE_CHARS = 20_000;
const POST_CHARS = 2_000;

const n = (v: unknown, dflt: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(v ?? dflt)) || dflt));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ---- parsing, as autobrowse writes it ----

interface Role {
  title: string;
  company: string;
  companyUrl: string | null;
  current: boolean;
  dates: string | null;
}
interface School {
  school: string;
  schoolUrl: string | null;
  degree: string | null;
  dates: string | null;
}
interface Person {
  name: string;
  headline: string | null;
  location: string | null;
  connections: string | null;
  about: string | null;
  roles: Role[];
  education: School[];
}

const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const RANGE_LINE = /^(?:[A-Z][a-z]{2} )?\d{4}( - |\b)/;
const CURRENT = /\s*\(Current\)\s*$/;
const DATES = /^(?:[A-Z][a-z]{2} )?\d{4} - /;

function companyOf(raw: string): { company: string; companyUrl: string | null } {
  const s = raw.trim();
  const m = LINK.exec(s);
  return m
    ? { company: (m[1] ?? "").trim(), companyUrl: m[2] ?? null }
    : { company: s, companyUrl: null };
}

function section(lines: string[], name: string): string[] {
  const start = lines.indexOf(`## ${name}`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function prose(lines: string[]): string | null {
  const text = lines
    .filter((l) => !l.startsWith("|"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

function schoolsOf(lines: string[]): School[] {
  const out: School[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (!l.startsWith("### ")) continue;
    const entry = l.slice(4).trim();
    const at = entry.lastIndexOf(" - ");
    const { company, companyUrl } = companyOf(at > 0 ? entry.slice(at + 3) : entry);
    const next = lines.slice(i + 1).find(Boolean) ?? "";
    out.push({
      school: company,
      schoolUrl: companyUrl,
      degree: at > 0 ? entry.slice(0, at).trim() : null,
      dates: RANGE_LINE.test(next) ? next : null,
    });
  }
  return out;
}

/** One profile as Exa's people index writes it; null when it names nobody. */
export function exaProfile(text: string): Person | null {
  const lines = text.split("\n").map((l) => l.trim());
  const name = lines
    .find((l) => l.startsWith("# "))
    ?.slice(2)
    .trim();
  if (!name) return null;
  const head = lines.slice(lines.indexOf(`# ${name}`) + 1).filter(Boolean);
  const body = (i: number) => {
    const l = head[i];
    return l && !l.startsWith("#") && !/connections|followers/.test(l) ? l : null;
  };
  const roles: Role[] = [];
  const start = lines.indexOf("## Experience");
  let group: { company: string; companyUrl: string | null } | null = null;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i] ?? "";
      if (l.startsWith("## ")) break;
      const next = lines.slice(i + 1).find(Boolean) ?? "";
      const dates = DATES.test(next) ? next : null;
      if (l.startsWith("#### ") && group) {
        const title = l.slice(5);
        roles.push({
          title: title.replace(CURRENT, ""),
          ...group,
          current: CURRENT.test(title),
          dates,
        });
      } else if (l.startsWith("### ")) {
        const entry = l.slice(4);
        const current = CURRENT.test(entry);
        const plain = entry.replace(CURRENT, "");
        const at = plain.lastIndexOf(" - ");
        if (at > 0) {
          group = null;
          roles.push({
            title: plain.slice(0, at).trim(),
            ...companyOf(plain.slice(at + 3)),
            current,
            dates,
          });
        } else group = companyOf(plain);
      }
    }
  }
  const conns = /^([\d,]+\+?) connections/m.exec(text);
  return {
    name,
    headline: body(0),
    location: body(1),
    connections: conns?.[1] ?? null,
    about: prose(section(lines, "About")),
    roles,
    education: schoolsOf(section(lines, "Education")),
  };
}

/** A page's first segment after `/in/` or `/company/`, any LinkedIn host. */
export function linkedinSlug(raw: string, kind: "in" | "company"): string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Miss(`not a URL: want a linkedin.com/${kind}/ page`, 400);
  }
  const host = u.hostname.toLowerCase();
  const [first, slug] = u.pathname.split("/").filter(Boolean);
  if (!(host === "linkedin.com" || host.endsWith(".linkedin.com")) || first !== kind || !slug)
    throw new Miss(`not a linkedin.com/${kind}/ page`, 400);
  return decodeURIComponent(slug);
}

function rangeOf(line: string | null): { dates?: string; location?: string } {
  if (!line) return {};
  const range = /^((?:[A-Z][a-z]{2} )?\d{4}(?: - (?:Present|(?:[A-Z][a-z]{2} )?\d{4}))?)/.exec(
    line,
  );
  const place = / in (.+)$/.exec(line);
  return {
    ...(range?.[1] ? { dates: range[1] } : {}),
    ...(place?.[1] ? { location: place[1].trim() } : {}),
  };
}

const some = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined && v !== "";

function cachedProfile(text: string, vanity: string, source: string) {
  const p = exaProfile(text);
  if (!p) return null;
  return {
    name: p.name,
    vanity,
    url: `${LI}/in/${vanity}/`,
    ...(some(p.headline) ? { headline: p.headline } : {}),
    ...(some(p.location) ? { location: p.location.replace(/\s*\([A-Z]{2}\)$/, "") } : {}),
    ...(some(p.connections) ? { connections: p.connections } : {}),
    ...(some(p.about) ? { about: p.about } : {}),
    roles: p.roles.map((r) => ({
      title: r.title,
      company: r.company,
      ...(r.companyUrl ? { companyUrl: r.companyUrl } : {}),
      ...rangeOf(r.dates),
      current: r.current,
    })),
    education: p.education.map((e) => ({
      school: e.school,
      ...(e.schoolUrl ? { schoolUrl: e.schoolUrl } : {}),
      ...(e.degree ? { degree: e.degree } : {}),
      ...rangeOf(e.dates),
    })),
    text,
    source,
  };
}

const COUNT = (s: string | undefined) => {
  const v = s ? Number(s.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(v) ? v : undefined;
};

/** A company page as Exa writes it; null when it has no name. */
export function exaCompany(text: string): Record<string, string | number> | null {
  const lines = text.split("\n").map((l) => l.trim());
  const name = lines
    .find((l) => l.startsWith("# "))
    ?.slice(2)
    .trim();
  if (!name) return null;
  const facts = new Map<string, string>();
  for (const l of [...section(lines, "Company Details"), ...section(lines, "Workforce")]) {
    const m = /^- ([A-Za-z ]+): (.+)$/.exec(l);
    if (m?.[1] && m[2] && !facts.has(m[1])) facts.set(m[1], m[2].trim());
  }
  const homepage = facts.get("Homepage");
  const li = facts.get("LinkedIn");
  const out: Record<string, string | number> = { name };
  const set = (k: string, v: string | number | null | undefined) => {
    if (some(v)) out[k] = v;
  };
  set(
    "website",
    homepage ? (/^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`) : undefined,
  );
  set("phone", facts.get("Phone"));
  set("industry", facts.get("Industry"));
  set("size", facts.get("Company Size"));
  set("headquarters", facts.get("Headquarters"));
  set("founded", facts.get("Founded Year"));
  set("type", facts.get("Type"));
  set(
    "employees",
    COUNT(facts.get("Employees")) ?? COUNT(/ employs ([\d,]+) people/.exec(text)?.[1]),
  );
  set("about", prose(section(lines, "About")));
  if (li) {
    try {
      set("handle", linkedinSlug(li, "company"));
    } catch {
      // A LinkedIn line that is not a company page names no handle.
    }
  }
  return out;
}

/** `https://www.Acme.com/about` → `acme.com`. */
const hostOf = (raw: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
};

// ---- the routes ----

type Exa = (path: string, body: unknown) => Promise<unknown>;
type Result = { url?: string; title?: string | null; text?: string } & Record<string, unknown>;

async function cachedPage(exa: Exa, url: string): Promise<{ text: string; source: string }> {
  const body = (await exa("/contents", {
    urls: [url],
    livecrawl: "never",
    text: { maxCharacters: PAGE_CHARS },
  })) as {
    results?: Array<{ text?: string }>;
    statuses?: Array<{
      status?: string;
      source?: string;
      error?: { httpStatusCode?: number; tag?: string };
    }>;
  };
  const status = body.statuses?.[0];
  if (status?.status === "error") {
    if (status.error?.httpStatusCode === 404)
      throw new Miss("exa holds no copy of that page (ENTITY_NOT_FOUND)", 404);
    throw new Miss(`exa could not give that page: ${status.error?.tag ?? "error"}`, 502);
  }
  const text = body.results?.[0]?.text?.trim();
  if (!text) throw new Miss("exa gave that page with no text", 502);
  return { text, source: status?.source ?? "cached" };
}

async function route(exa: Exa, path: string, input: Record<string, unknown>): Promise<unknown> {
  const results = async (body: Record<string, unknown>) =>
    ((await exa("/search", body)) as { results?: Result[] }).results ?? [];
  if (path === "/people") {
    const q = str(input.q);
    if (!q) throw new Miss("q: want a search", 400);
    const raw = await results({
      query: q,
      category: "people",
      numResults: n(input.n, 10, 25),
      type: "auto",
      contents: { text: { maxCharacters: 8000 } },
    });
    const people = raw.flatMap((r) => {
      const p = r.text && r.url ? exaProfile(r.text) : null;
      return p ? [{ ...p, url: r.url }] : [];
    });
    return { query: q, people, via: "exa", raw };
  }
  if (path === "/companies") {
    const want = hostOf(str(input.domain));
    if (!want.includes(".")) throw new Miss("domain: want a bare domain like acme.com", 400);
    const raw = await results({
      query: want,
      category: "company",
      numResults: n(input.n, 3, 10),
      type: "auto",
      contents: { text: { maxCharacters: 8000 } },
    });
    const companies = raw.flatMap((r) => {
      const c = r.text ? exaCompany(r.text) : null;
      if (!c || !r.url) return [];
      const website = typeof c.website === "string" ? c.website : null;
      return [
        {
          ...c,
          linkedin: c.handle ? `${LI}/company/${c.handle}/` : null,
          url: r.url,
          homepageMatches: website ? hostOf(website) === want : false,
        },
      ];
    });
    return { domain: want, companies, via: "exa", raw };
  }
  if (path === "/exa/companies") {
    const q = str(input.q);
    if (!q) throw new Miss("q: want a search", 400);
    const { results: rs, ...meta } = (await exa("/search", {
      query: q,
      category: "company",
      numResults: n(input.n, 10, 25),
      type: "auto",
    })) as { results?: Result[] } & Record<string, unknown>;
    const out = (rs ?? []).flatMap((r) =>
      typeof r.url === "string"
        ? [{ url: r.url, title: r.title ?? null, domain: hostOf(r.url), raw: r }]
        : [],
    );
    return { query: q, results: out, via: "exa", meta };
  }
  if (path === "/linkedin/profile") {
    const vanity = linkedinSlug(str(input.url), "in");
    const { text, source } = await cachedPage(exa, `${LI}/in/${vanity}`);
    const p = cachedProfile(text, vanity, source);
    if (!p) throw new Miss("exa's copy of that page is not a profile", 502);
    return p;
  }
  if (path === "/linkedin/company") {
    const slug = linkedinSlug(str(input.url), "company");
    const { text, source } = await cachedPage(exa, `${LI}/company/${slug}`);
    const c = exaCompany(text);
    if (!c) throw new Miss("exa's copy of that page is not a company", 502);
    const handle = typeof c.handle === "string" ? c.handle : slug;
    return { ...c, handle, url: `${LI}/company/${handle}/`, text, source };
  }
  if (path === "/linkedin/posts") {
    const q = str(input.q);
    if (!q) throw new Miss("q: want a search", 400);
    const since = str(input.since);
    const raw = await results({
      query: q,
      includeDomains: ["linkedin.com/posts"],
      numResults: n(input.n, 10, 25),
      type: "auto",
      ...(since ? { startPublishedDate: since } : {}),
      contents: { text: { maxCharacters: POST_CHARS } },
    });
    const posts = raw.flatMap((r) =>
      typeof r.url === "string" && /linkedin\.com\/posts\//i.test(r.url)
        ? [
            {
              url: r.url,
              title: r.title ?? null,
              author: (r.author as string | null | undefined) ?? null,
              publishedDate: (r.publishedDate as string | null | undefined) ?? null,
              text: r.text ?? "",
              raw: r,
            },
          ]
        : [],
    );
    return { query: q, posts, via: "exa" };
  }
  throw new Miss(`web ${path} isn't an Exa route`, 409);
}

/** One Exa-backed `web` route on the client's own key. The key rides a header, never the URL. */
export async function exaRoute(
  key: string,
  path: string,
  input: Record<string, unknown> = {},
  fetch: FetchLike = globalThis.fetch,
): Promise<DirectAnswer> {
  const exa: Exa = async (p, body) => {
    const res = await fetch(`https://api.exa.ai${p}`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    // Out of credit stays 402, as autobrowse says it; anything else is Exa failing.
    if (!res.ok)
      throw new Miss(
        `exa: HTTP ${res.status} ${text.slice(0, 200)}`,
        res.status === 402 ? 402 : 502,
      );
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Miss("exa: not json", 502);
    }
  };
  try {
    return { ok: true, status: 200, body: await route(exa, path, input) };
  } catch (err) {
    if (err instanceof Miss) return { ok: false, status: err.status, body: { error: err.message } };
    throw err;
  }
}

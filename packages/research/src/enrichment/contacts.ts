/**
 * Every phone, LinkedIn link and social profile a firm put on its own pages,
 * read once per page. Free, versioned, auditable like `email_scan`: one
 * `contact_scan` enrichment per document (model "deterministic"), and the
 * points land in `contact_points`, one row per (firm, kind, value) with a count
 * of the pages that carry it. Bump CONTACTS_VERSION to re-read history after
 * improving the readers.
 *
 * Trusted columns stay the lookups' own: `companies.linkedin_url` and
 * `people.linkedin_url` are written only when a profile read confirms them.
 * Readers want both, so `lead_sheet` takes the trusted link first, then the
 * published one.
 */
import { companies, inPlay, people } from "@wren/core";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { companyPageUrl, linkedinCompany } from "../companies/profile.js";
import { htmlOf, type PageStore, telHrefs } from "../pages.js";
import { linkedinProfile } from "../people/profile-link.js";
import { phonesOf } from "../phones.js";
import {
  type ContactKind,
  type ContactSource,
  contactPoints,
  type Document,
  documents,
  enrichments,
} from "../schema.js";
import { linkedinLinks } from "./profiles.js";

export const CONTACTS_VERSION = "v1";
export const CONTACTS_MODEL = "deterministic";
/** A firm with more people than this is a registry, not a team page: no name matching. */
const MAX_PEOPLE = 300;
/** `contact_points.value` is varchar(512); a longer "profile" is a broken link. */
const MAX_VALUE = 512;
/** LinkedIn caps a company page's public URL name at 100 characters. */
const MAX_LINKEDIN_HANDLE = 100;

export interface PagePoint {
  kind: ContactKind;
  value: string;
  source: ContactSource;
  /** The person whose name the link sits by (team pages); null = the firm's, or nobody we hold. */
  personId: number | null;
}

type Social = Exclude<ContactKind, "phone" | "linkedin_company" | "linkedin_person">;

const SOCIAL_HOSTS: Record<string, Social> = {
  "x.com": "x",
  "twitter.com": "x",
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "youtube.com": "youtube",
  "tiktok.com": "tiktok",
};
/** Hosts that are the profile, not a CDN or widget host (platform.twitter.com). */
const PROFILE_SUBDOMAIN = /^(?:www|m|mobile|web)\.|^[a-z]{2}\./;

/** Paths that are the platform's own (share buttons, pixels, embeds), never a profile. */
const RESERVED: Record<Social, ReadonlySet<string>> = {
  x: new Set(
    "share intent home i search hashtag login signup explore settings privacy tos notifications messages compose widgets about en account download".split(
      " ",
    ),
  ),
  instagram: new Set(
    "p reel reels explore accounts stories tv about developer legal direct web".split(" "),
  ),
  facebook: new Set(
    "sharer sharer.php share share.php dialog plugins tr 2008 login login.php home.php groups events watch photo photo.php photos story.php permalink.php hashtag help policies privacy legal business ads pages people".split(
      " ",
    ),
  ),
  youtube: new Set(),
  tiktok: new Set(),
};
/** Site builders' and platforms' own handles: a template's default footer, not the firm. */
const TEMPLATE_HANDLES: ReadonlySet<string> = new Set(
  "wix wixcom wix-com squarespace wordpress wordpressdotcom godaddy weebly hubspot elementor shopify webflow duda facebook instagram twitter youtube tiktok linkedin x".split(
    " ",
  ),
);

/** One canonical URL per social profile, or null for anything that is not one. */
export function socialProfile(raw: string): { kind: Social; url: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const kind = SOCIAL_HOSTS[host] ?? SOCIAL_HOSTS[host.replace(PROFILE_SUBDOMAIN, "")];
  if (!kind) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const first = segs[0] ?? "";
  if (RESERVED[kind].has(first.toLowerCase())) return null;
  const ok = (handle: string) => !TEMPLATE_HANDLES.has(handle.toLowerCase().replace(/^@/, ""));
  switch (kind) {
    case "x": {
      if (!/^[A-Za-z0-9_]{1,15}$/.test(first) || !ok(first)) return null;
      return { kind, url: `https://x.com/${first.toLowerCase()}` };
    }
    case "instagram": {
      if (!/^[A-Za-z0-9._]{1,30}$/.test(first) || !ok(first)) return null;
      return { kind, url: `https://www.instagram.com/${first.toLowerCase()}/` };
    }
    case "facebook": {
      if (first === "profile.php") {
        const id = u.searchParams.get("id");
        return id && /^\d+$/.test(id)
          ? { kind, url: `https://www.facebook.com/profile.php?id=${id}` }
          : null;
      }
      if (!/^[A-Za-z0-9.-]{2,80}$/.test(first) || !ok(first)) return null;
      return { kind, url: `https://www.facebook.com/${first.toLowerCase()}` };
    }
    case "youtube": {
      if (/^@[\w.-]{2,100}$/.test(first) && ok(first))
        return { kind, url: `https://www.youtube.com/${first.toLowerCase()}` };
      const name = segs[1];
      if (
        ["channel", "c", "user"].includes(first) &&
        name &&
        /^[\w.-]{2,100}$/.test(name) &&
        ok(name)
      )
        return {
          kind,
          url: `https://www.youtube.com/${first}/${first === "channel" ? name : name.toLowerCase()}`,
        };
      return null;
    }
    case "tiktok": {
      if (!/^@[\w.]{2,24}$/.test(first) || !ok(first)) return null;
      return { kind, url: `https://www.tiktok.com/${first.toLowerCase()}` };
    }
  }
}

// Absolute or protocol-relative URLs on the hosts above: hrefs, JSON-LD sameAs, data attributes.
const PROFILE_URL =
  /(?:https?:)?\/\/(?:[\w-]+\.)*(?:linkedin|facebook|fb|instagram|twitter|x|youtube|tiktok)\.com(?:\/[^\s"'<>()\\]*)?/gi;

/**
 * Every contact point on one page: phones (`tel:` links, then text), the
 * LinkedIn company pages, every LinkedIn profile (tied to a person we hold when
 * it sits by their name), and the other socials. Pure.
 */
export function contactsInPage(
  html: string | null,
  text: string,
  opts: {
    /** An archived page's `tel:` targets, for when its HTML is out of reach. */
    tels?: readonly string[] | null;
    people?: readonly { id: number; first: string | null; last: string | null }[];
  } = {},
): PagePoint[] {
  const points = new Map<string, PagePoint>();
  const add = (p: PagePoint) => {
    if (p.value.length > MAX_VALUE) return;
    const key = `${p.kind} ${p.value}`;
    if (!points.has(key)) points.set(key, p);
  };
  const tels = html !== null ? telHrefs(html) : (opts.tels ?? []);
  for (const f of phonesOf(tels, text)) {
    add({
      kind: "phone",
      value: f.e164,
      source: f.kind === "tel_link" ? "link" : "text",
      personId: null,
    });
  }
  if (html === null) return [...points.values()];

  const markup = html.replace(/\\\//g, "/");
  const profiles = new Set<string>();
  for (const m of markup.matchAll(PROFILE_URL)) {
    const found = m[0].replace(/&amp;/gi, "&");
    const url = found.startsWith("//") ? `https:${found}` : found;
    const handle = linkedinCompany(url);
    if (
      handle &&
      (handle.length > MAX_LINKEDIN_HANDLE || TEMPLATE_HANDLES.has(handle.toLowerCase()))
    )
      continue;
    if (handle) {
      add({
        kind: "linkedin_company",
        value: companyPageUrl(handle),
        source: "link",
        personId: null,
      });
      continue;
    }
    const profile = linkedinProfile(url);
    if (profile) {
      profiles.add(profile.url);
      continue;
    }
    const social = socialProfile(url);
    if (social) add({ kind: social.kind, value: social.url, source: "link", personId: null });
  }

  // A profile by exactly one held person's name is theirs; by two, nobody's.
  const owner = new Map<string, number | null>();
  const team = opts.people ?? [];
  if (profiles.size > 0 && team.length <= MAX_PEOPLE) {
    for (const p of team) {
      for (const url of linkedinLinks(html, { first: p.first, last: p.last }).people) {
        owner.set(url, owner.has(url) && owner.get(url) !== p.id ? null : p.id);
      }
    }
  }
  for (const url of profiles) {
    add({ kind: "linkedin_person", value: url, source: "link", personId: owner.get(url) ?? null });
  }
  return [...points.values()];
}

export interface ContactsStats {
  selected: number;
  scanned: number;
  points: number;
  pages_with_points: number;
}

export type ContactsTarget = Pick<
  Document,
  "id" | "companyId" | "url" | "text" | "html" | "htmlKey" | "telHrefs"
>;

const readDocumentIds = (db: Queryable) =>
  db
    .select({ id: enrichments.documentId })
    .from(enrichments)
    .where(
      and(
        eq(enrichments.kind, "contact_scan"),
        eq(enrichments.model, CONTACTS_MODEL),
        eq(enrichments.promptVersion, CONTACTS_VERSION),
      ),
    );

const TARGET = {
  id: documents.id,
  companyId: documents.companyId,
  url: documents.url,
  text: documents.text,
  html: documents.html,
  htmlKey: documents.htmlKey,
  telHrefs: documents.telHrefs,
};

/** A firm's own pages not read at this version: webpages and PDFs with markup or an archived copy. */
export async function selectContactTargets(
  db: Queryable,
  opts: { limit?: number | undefined; niche?: string | null | undefined } = {},
): Promise<number[]> {
  const conditions = [
    notInArray(documents.id, readDocumentIds(db)),
    isNotNull(documents.companyId),
    inArray(documents.kind, ["webpage", "pdf"]),
    or(isNotNull(documents.html), isNotNull(documents.htmlKey), sql`${documents.text} <> ''`),
    inPlay,
  ];
  if (opts.niche != null) conditions.push(eq(companies.niche, opts.niche));
  const q = db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(companies, eq(documents.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(asc(documents.id));
  const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
  return rows.map((r) => r.id);
}

export async function loadContactTarget(db: Queryable, id: number): Promise<ContactsTarget | null> {
  const [row] = await db.select(TARGET).from(documents).where(eq(documents.id, id));
  return row ?? null;
}

/**
 * One page read: its `contact_scan` row and its points. An archived page the
 * bucket cannot return still gives its phones (`tel_hrefs` survive archiving).
 */
export async function scanContacts(
  db: Queryable,
  doc: ContactsTarget,
  runId: string | null = null,
  pages: PageStore | null = null,
): Promise<PagePoint[]> {
  const html = await htmlOf(doc, pages).catch(() => null);
  const team =
    doc.companyId === null
      ? []
      : await db
          .select({ id: people.id, first: people.firstName, last: people.lastName })
          .from(people)
          .where(eq(people.companyId, doc.companyId))
          .limit(MAX_PEOPLE + 1);
  const points = contactsInPage(html, doc.text, { tels: doc.telHrefs, people: team });
  await db.insert(enrichments).values({
    documentId: doc.id,
    kind: "contact_scan",
    model: CONTACTS_MODEL,
    promptVersion: CONTACTS_VERSION,
    output: { points, html: html !== null },
    runId,
  });
  if (doc.companyId !== null && points.length > 0) {
    await db
      .insert(contactPoints)
      .values(
        points.map((p) => ({
          companyId: doc.companyId as number,
          personId: p.personId,
          kind: p.kind,
          value: p.value,
          source: p.source,
          documentId: doc.id,
          sourceUrl: doc.url,
        })),
      )
      .onConflictDoUpdate({
        target: [contactPoints.companyId, contactPoints.kind, contactPoints.value],
        set: {
          pages: sql`${contactPoints.pages} + 1`,
          seenAt: sql`now()`,
          personId: sql`coalesce(${contactPoints.personId}, excluded.person_id)`,
          // 'link' sorts before 'text': a link seen anywhere wins.
          source: sql`least(${contactPoints.source}, excluded.source)`,
        },
      });
  }
  return points;
}

export interface ContactsRunOptions {
  limit?: number;
  niche?: string | null;
  runId?: string | null;
  pages?: PageStore | null;
}

/** Every unread page, one transaction each (the CLI and tests; Restate runs it in batches). */
export async function runContacts(
  db: Queryable,
  opts: ContactsRunOptions = {},
): Promise<ContactsStats> {
  const ids = await selectContactTargets(db, opts);
  const stats: ContactsStats = {
    selected: ids.length,
    scanned: 0,
    points: 0,
    pages_with_points: 0,
  };
  for (const id of ids) {
    const doc = await loadContactTarget(db, id);
    if (!doc) continue;
    const points = await atomic(db, (tx) =>
      scanContacts(tx, doc, opts.runId ?? null, opts.pages ?? null),
    );
    stats.scanned += 1;
    stats.points += points.length;
    if (points.length) stats.pages_with_points += 1;
  }
  return stats;
}

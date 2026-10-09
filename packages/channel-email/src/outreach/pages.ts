/**
 * Sites pages in an email (designs/2026-10-07-sites.md, Phase 3): `{page.<slug>}` renders one of
 * Wren's pages at `/o/<slug>` with the email's utm, its link code as `utm_content` so the visit
 * and the form name the email. Compose refuses a sequence whose page isn't live; the send holds
 * a step whose page went off since. Never a dead link.
 */

import { factKeys, type Template } from "@wren/core/slots";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

/** Wren's own domain, where its pages live (`WREN_SITE` in @wren/sites). */
export const PAGE_ORIGIN = "https://wrenautomation.com";
const PAGE_KEY = /^page\.([a-z0-9][a-z0-9-]*)$/;
const PAGE_LINK = /https:\/\/wrenautomation\.com\/o\/([a-z0-9][a-z0-9-]*)(?![a-z0-9/-])/g;

/** The page slugs the templates link, sorted. */
export function pageSlugs(templates: Iterable<Template>): string[] {
  const out = new Set<string>();
  for (const t of templates)
    for (const key of factKeys(t)) {
      const m = PAGE_KEY.exec(key);
      if (m?.[1]) out.add(m[1]);
    }
  return [...out].sort();
}

/** Which of these slugs are Wren's live data pages. */
export async function livePages(db: Queryable, slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db.execute<{ slug: string }>(
    sql`select slug from site_pages where client is null and source = 'data' and status = 'live'
        and slug in (${sql.join(
          slugs.map((s) => sql`${s}`),
          sql`, `,
        )})`,
  );
  return new Set([...rows].map((r) => r.slug));
}

/** The slugs a sequence links, or throws naming each one that isn't a live page of Wren's. */
export async function checkPages(
  db: Queryable,
  sequence: string,
  templates: Iterable<Template>,
): Promise<string[]> {
  const slugs = pageSlugs(templates);
  const live = await livePages(db, slugs);
  const off = slugs.filter((s) => !live.has(s));
  if (off.length > 0)
    throw new Error(
      `sequence '${sequence}' links ${off.map((s) => `/o/${s}`).join(", ")}, not a live page of Wren's: publish it in Sites or drop the link`,
    );
  return slugs;
}

/** `page.<slug>` facts for one email: the page with the email's utm. */
export function pageFacts(
  slugs: readonly string[],
  offer: string,
  code: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slug of slugs) {
    const url = new URL(`/o/${slug}`, PAGE_ORIGIN);
    url.searchParams.set("utm_source", "email");
    url.searchParams.set("utm_medium", "email");
    url.searchParams.set("utm_campaign", offer);
    url.searchParams.set("utm_content", code);
    out[`page.${slug}`] = url.toString();
  }
  return out;
}

/** The pages a written email links. */
export function pagesIn(body: string): string[] {
  return [...new Set([...body.matchAll(PAGE_LINK)].map((m) => m[1] as string))];
}

/** The first page this email links that isn't live any more, or null. */
export async function offPage(db: Queryable, body: string): Promise<string | null> {
  const slugs = pagesIn(body);
  if (slugs.length === 0) return null;
  const live = await livePages(db, slugs);
  return slugs.find((s) => !live.has(s)) ?? null;
}

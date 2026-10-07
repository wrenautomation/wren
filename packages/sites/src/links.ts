/**
 * Tracked links made in the portal: one `/go/` link per owner, page and utm, to copy into a post,
 * an ad or a text. Hits are read back in `site_link_records` (`./views.ts`).
 */
import type { Db, Queryable } from "@wren/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { goLinkOf, linkUtm, linkWord } from "./hops.js";
import { channelOf, WREN_SITE } from "./model.js";
import { type SiteLink, siteLinks, sitePages } from "./schema.js";
import { SitesRefusal, UUID } from "./store.js";

export interface LinkTarget {
  id: string;
  title: string;
  slug: string;
  status: string;
}

/** The pages a link can go to: the owner's data pages that aren't retired, live first. */
export async function linkTargets(db: Queryable, client: string | null): Promise<LinkTarget[]> {
  const rows = await db
    .select({
      id: sitePages.id,
      title: sitePages.title,
      slug: sitePages.slug,
      status: sitePages.status,
    })
    .from(sitePages)
    .where(
      and(
        client === null ? isNull(sitePages.client) : eq(sitePages.client, client),
        eq(sitePages.source, "data"),
        sql`${sitePages.status} <> 'retired'`,
        sql`${sitePages.slug} is not null`,
      ),
    )
    .orderBy(sql`${sitePages.status} = 'live' desc`, asc(sitePages.title))
    .limit(500);
  return rows as LinkTarget[];
}

/** The host a link lives on: Wren's site, or the client's active portal host (null: none yet). */
export async function linkHost(db: Queryable, client: string | null): Promise<string | null> {
  if (client === null) return WREN_SITE;
  const rows = await db.execute(sql`
    select hostname from client_domains where client_id = ${client} and status = 'active'
    order by created_at limit 1`);
  return ((rows as unknown as { hostname: string }[])[0]?.hostname as string) ?? null;
}

export interface NewLink {
  client: string | null;
  page: string;
  /** The short name: `ads`, `ig`, `sms`, or a word of the team's. */
  link: string;
  /** Left out: the page's slug. */
  campaign?: string | null;
  /** The post or ad id. */
  content?: string | null;
  name?: string | null;
  by: string;
}

export interface MadeLink extends SiteLink {
  url: string | null;
  slug: string;
}

/**
 * Make a link, or hand back the one already made for the same page and utm. Its URL is null while
 * the client has no live host.
 */
export async function createLink(db: Db, l: NewLink): Promise<MadeLink> {
  if (!UUID.test(l.page)) throw new SitesRefusal("no such page", 404);
  const [page] = await db.select().from(sitePages).where(eq(sitePages.id, l.page));
  if (!page || page.client !== l.client) throw new SitesRefusal("no such page", 404);
  if (page.source !== "data" || !page.slug)
    throw new SitesRefusal("a code page has its own links", 409);
  if (page.status === "retired") throw new SitesRefusal("this page is retired", 409);
  const link = linkWord(l.link);
  if (!link) throw new SitesRefusal("pick where it's posted", 400);
  const campaign = linkWord(l.campaign) || page.slug.slice(0, 80);
  const content = linkWord(l.content) || null;
  const utm = linkUtm(link, l.client === null);
  const name = l.name?.trim().slice(0, 200) || null;
  await db
    .insert(siteLinks)
    .values({
      client: l.client,
      page: page.id,
      link,
      source: utm.source,
      medium: utm.medium,
      channel: channelOf(utm),
      campaign,
      content,
      name,
      createdBy: l.by,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(siteLinks)
    .where(
      and(
        l.client === null ? isNull(siteLinks.client) : eq(siteLinks.client, l.client),
        eq(siteLinks.page, page.id),
        eq(siteLinks.link, link),
        eq(siteLinks.campaign, campaign),
        content === null ? isNull(siteLinks.content) : eq(siteLinks.content, content),
      ),
    );
  if (!row) throw new Error("link not saved");
  const host = await linkHost(db, l.client);
  const url = host ? goLinkOf({ host, link, campaign, content, slug: page.slug }) : null;
  return { ...row, url, slug: page.slug };
}

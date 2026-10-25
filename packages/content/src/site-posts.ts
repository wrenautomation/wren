/**
 * Posts made on the site by hand, read back as published drafts (designs/2026-10-22-drift-reconcile.md),
 * so `ContentMetrics` reads their numbers like any other post. A listed post whose ref no draft
 * has is first matched by its words to a draft whose send was lost (`publishing`, `failed`, or
 * marked posted with no id): that draft is stamped. The rest become a `site` idea and its draft.
 */
import type { Platform, PublishedRow } from "@wren/core/content";
import { CanonError, canonRef } from "@wren/core/objects";
import { atomic, type Queryable } from "@wren/db";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { markPublished } from "./queue.js";
import { contentDrafts, contentIdeas } from "./schema.js";

/** How far back a lost send may sit and still be the listed post. */
const LOST_DAYS = 60;
/** The words compared: enough to tell two posts apart, short of where a link is appended. */
const KEY_CHARS = 60;
const MIN_KEY = 20;

interface SitePostsKept {
  /** New drafts for posts made on the site. */
  added: number;
  /** Drafts whose send was lost, found on the site and stamped. */
  settled: number;
}

/** The opening words, folded: case, spacing and a listing's "…" never decide. */
const wordsKey = (s: string): string =>
  s.replace(/…$/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, KEY_CHARS);

const same = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  return n >= MIN_KEY && a.slice(0, n) === b.slice(0, n);
};

export async function keepSitePosts(
  db: Queryable,
  platform: Platform,
  rows: readonly PublishedRow[],
  now: Date,
): Promise<SitePostsKept> {
  const listed = new Map<string, PublishedRow>();
  for (const r of rows) {
    try {
      const ref = canonRef(platform, "post", r.id);
      if (!listed.has(ref)) listed.set(ref, r);
    } catch (err) {
      if (!(err instanceof CanonError)) throw err;
    }
  }
  if (!listed.size) return { added: 0, settled: 0 };
  const refs = [...listed.keys()];
  const known = new Set(
    (
      await db
        .select({ ref: contentDrafts.publishedId })
        .from(contentDrafts)
        .where(and(eq(contentDrafts.platform, platform), inArray(contentDrafts.publishedId, refs)))
    ).map((d) => d.ref),
  );
  for (const i of await db
    .select({ ref: contentIdeas.ref })
    .from(contentIdeas)
    .where(
      inArray(
        contentIdeas.ref,
        refs.map((r) => `site:${platform}:${r}`),
      ),
    ))
    known.add(i.ref?.slice(`site:${platform}:`.length) ?? null);
  const fresh = [...listed].filter(([ref]) => !known.has(ref));
  if (!fresh.length) return { added: 0, settled: 0 };

  const lost = await db
    .select({ id: contentDrafts.id, text: contentDrafts.text, title: contentDrafts.title })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.platform, platform),
        gte(contentDrafts.createdAt, new Date(now.getTime() - LOST_DAYS * 86_400_000)),
        or(
          inArray(contentDrafts.status, ["publishing", "failed"]),
          and(eq(contentDrafts.status, "published"), isNull(contentDrafts.publishedId)),
        ),
      ),
    );
  const open = lost.map((d) => ({ id: d.id, key: wordsKey(d.title ?? d.text) }));

  let added = 0;
  let settled = 0;
  for (const [ref, r] of fresh) {
    const words = r.title ?? r.text ?? r.preview;
    const key = wordsKey(words);
    const at = open.findIndex((d) => same(d.key, key));
    if (at >= 0) {
      const [d] = open.splice(at, 1);
      await markPublished(db, (d as { id: string }).id, r, null, "site");
      settled++;
      continue;
    }
    await atomic(db, async (tx) => {
      const [idea] = await tx
        .insert(contentIdeas)
        .values({
          text: words.slice(0, 10_000),
          source: "site",
          status: "drafted",
          ref: `site:${platform}:${ref}`,
        })
        .returning({ id: contentIdeas.id });
      const [draft] = await tx
        .insert(contentDrafts)
        .values({
          ideaId: (idea as { id: string }).id,
          platform,
          text: r.text ?? r.preview,
          title: r.title?.slice(0, 2000) ?? null,
          promptVersion: "site",
          edited: true,
        })
        .returning({ id: contentDrafts.id });
      await markPublished(tx, (draft as { id: string }).id, r, null, "site");
    });
    added++;
  }
  return { added, settled };
}

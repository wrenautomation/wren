/**
 * Learn's items as source records in the knowledge repo (designs/2026-11-09-knowledge-repo.md,
 * WA-1230): caption and transcript as the body, the breakdown, scores and saves as fields. One URL
 * is one source (`sourceId`, `urlKey`), so an item an SOP already holds merges into that record.
 * A rerun edits only what changed. Player state (position, opened, later) stays in Postgres.
 */
import type { Db } from "@wren/db";
import { type Change, loadWorking, sourceId, urlKey, write } from "@wrenautomation/knowledge";
import { eq, sql } from "drizzle-orm";
import { type BreakdownRow, breakdowns, type ItemType, items, sources } from "./schema.js";

type Kind = "video" | "reel" | "post" | "page" | "other";
const KIND: Record<ItemType, Kind> = {
  youtube: "video",
  shorts: "video",
  instagram: "reel",
  tiktok: "reel",
  reddit: "post",
  x: "post",
  newsletter: "page",
  blog: "page",
  releases: "page",
  link: "page",
  podcast: "other",
};

export interface ItemRow {
  item: typeof items.$inferSelect;
  breakdown: BreakdownRow | null;
  feed: { name: string; url: string; kind: string } | null;
  tags: string[];
}

const day = (d: Date | null) => d?.toISOString().slice(0, 10);
const stamp = (d: Date | null) => d?.toISOString();
const defined = (o: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length),
    ),
  );

/** One item as a source's fields and body. */
export function itemSource(r: ItemRow): { fields: Record<string, unknown>; body: string } {
  const i = r.item;
  const b = r.breakdown;
  const fields = defined({
    title: i.title.trim() || i.url,
    kind: KIND[i.type],
    url: i.url,
    handle: i.creator,
    date: day(i.publishedAt),
    length: i.duration,
    image: i.thumbnailUrl,
    learnItem: i.id,
    learnType: i.type,
    feed: r.feed ?? undefined,
    stats: i.stats ? { ...i.stats, at: stamp(i.statsAt) } : undefined,
    score: i.score,
    triage: i.verdict
      ? defined({ verdict: i.verdict, why: i.why, at: stamp(i.scoredAt) })
      : undefined,
    summary: i.summary,
    sops: i.changes,
    moments: i.moments,
    saved: i.savedAt
      ? defined({ at: stamp(i.savedAt), by: i.savedBy, via: i.savedVia })
      : undefined,
    starred: stamp(i.starredAt),
    pinned: stamp(i.pinnedAt),
    readAt: stamp(i.readAt),
    breakdown: b
      ? defined({
          hookStyle: b.hookStyle,
          hook: b.hook,
          hookWhy: b.hookWhy,
          topic: b.topic,
          kind: b.kind,
          facts: b.facts,
          beats: b.beats,
          ctaKind: b.ctaKind,
          cta: b.cta,
          by: b.by,
          at: stamp(b.createdAt),
        })
      : undefined,
  });
  const parts = [`# ${String(fields.title)}`];
  if (i.text.trim()) parts.push(`## Caption\n\n${i.text.trim()}`);
  if (i.transcript?.trim()) parts.push(`## Transcript\n\n${i.transcript.trim()}`);
  return { fields, body: parts.join("\n\n") };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields only Learn writes: they follow the item on every record. */
const LEARN_FIELDS = new Set([
  "learnItem",
  "learnType",
  "feed",
  "stats",
  "score",
  "triage",
  "summary",
  "sops",
  "moments",
  "saved",
  "starred",
  "pinned",
  "readAt",
  "breakdown",
]);

/**
 * The changes that bring the repo up to these items. Learn's own fields follow the item everywhere.
 * Title, URL and the like, and the body, follow it only on a record Learn made (`origin: learn`); on
 * another writer's record (an SOP's) they fill gaps only.
 */
export function itemChanges(
  have: ReadonlyMap<string, { fm: Record<string, unknown>; body: string }>,
  rows: readonly ItemRow[],
): Change[] {
  const byUrl = new Map<string, string>();
  for (const [id, { fm }] of have)
    if (fm.type === "source" && typeof fm.url === "string") byUrl.set(urlKey(fm.url), id);
  const out: Change[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = byUrl.get(urlKey(r.item.url)) ?? sourceId(r.item.url);
    if (seen.has(id)) continue;
    seen.add(id);
    const { fields, body } = itemSource(r);
    const tags = [...new Set(["learn", ...r.tags])];
    const cur = have.get(id);
    if (!cur) {
      out.push({
        op: "add",
        type: "source",
        id,
        origin: "learn",
        ...fields,
        title: String(fields.title),
        tags,
        body,
      });
      continue;
    }
    const ours = cur.fm.origin === "learn";
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields))
      if (ours || LEARN_FIELDS.has(k) ? !same(cur.fm[k], v) : cur.fm[k] === undefined) patch[k] = v;
    const curTags = (cur.fm.tags as string[] | undefined) ?? [];
    const allTags = [...new Set([...curTags, ...tags])];
    if (allTags.length !== curTags.length) patch.tags = allTags;
    if (ours && cur.body !== body) patch.body = body;
    if (Object.keys(patch).length) out.push({ op: "edit", id, ...patch });
  }
  return out;
}

/** Every item of a workspace into the repo: one commit, or none when nothing changed. */
export async function promoteItems(
  db: Db,
  root: string,
  client: string,
  who: { by: string; why: string },
): Promise<{ items: number; added: number; edited: number; commit: string | null }> {
  const rows = await db
    .select({
      item: items,
      breakdown: breakdowns,
      feed: { name: sources.name, url: sources.url, kind: sources.kind },
      tags: sql<
        string[]
      >`coalesce((select array_agg(t.tag order by t.tag) from learn.item_tags t where t.item_id = ${items.id}), '{}')`,
    })
    .from(items)
    .leftJoin(breakdowns, eq(breakdowns.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.client, client))
    .orderBy(items.id);
  const have = new Map(
    loadWorking(root).docs.map((l) => [
      l.doc.fm.id,
      { fm: l.doc.fm as Record<string, unknown>, body: l.doc.body },
    ]),
  );
  const changes = itemChanges(
    have,
    rows.map((r) => ({ ...r, feed: r.feed?.name ? r.feed : null })),
  );
  const added = changes.filter((c) => c.op === "add").length;
  const commit = changes.length ? (await write(root, changes, who)).commit : null;
  return { items: rows.length, added, edited: changes.length - added, commit };
}

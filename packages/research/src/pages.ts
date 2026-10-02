/**
 * Page HTML out of Postgres. Crawls write `documents.html` as before; a day
 * later `archivePages` moves it to the pages bucket (gzip, `pages/<id>.html.gz`)
 * and the row keeps `html_key` plus `tel_hrefs`, the page's `tel:` targets, so
 * the phone lift never needs the page back. Nothing is dropped: `htmlOf` reads
 * the page from wherever it is. HTML was ~85% of the database and of every
 * nightly dump; it is read once by the scans, then only on a re-scan.
 */
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Queryable } from "@wren/db";
import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { documents } from "./schema.js";

const zip = promisify(gzip);
const unzip = promisify(gunzip);

/** Where archived pages live. */
export interface PageStore {
  put(key: string, html: string): Promise<void>;
  get(key: string): Promise<string>;
}

export const pageKey = (documentId: number) => `pages/${documentId}.html.gz`;

/** A private S3 bucket (credentials from the default chain). */
export function s3PageStore(bucket: string, client: S3Client = new S3Client({})): PageStore {
  return {
    async put(key, html) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await zip(html),
          ContentType: "text/html",
          ContentEncoding: "gzip",
        }),
      );
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) throw new Error(`s3://${bucket}/${key}: empty body`);
      return (await unzip(await out.Body.transformToByteArray())).toString("utf8");
    },
  };
}

/** In memory: tests. */
export function memoryPageStore(): PageStore & { keys(): string[] } {
  const pages = new Map<string, Buffer>();
  return {
    async put(key, html) {
      pages.set(key, await zip(html));
    },
    async get(key) {
      const got = pages.get(key);
      if (!got) throw new Error(`no page at ${key}`);
      return (await unzip(got)).toString("utf8");
    },
    keys: () => [...pages.keys()],
  };
}

const TEL_HREF = /href\s*=\s*["']\s*tel:([^"']+)["']/gi;

/** The raw targets of a page's `tel:` links, in page order. */
export function telHrefs(html: string): string[] {
  return [...html.matchAll(TEL_HREF)].map((m) => m[1] as string);
}

/** A document's HTML: inline, else from the store; null when it never had any. */
export async function htmlOf(
  doc: { html: string | null; htmlKey: string | null },
  store: PageStore | null | undefined,
): Promise<string | null> {
  if (doc.html !== null) return doc.html;
  if (doc.htmlKey === null) return null;
  if (!store) throw new Error(`page ${doc.htmlKey} is archived and no page store is configured`);
  return store.get(doc.htmlKey);
}

export interface ArchiveStats {
  /** Pages moved to the store this pass. */
  moved: number;
  /** Their HTML, in characters, now out of Postgres. */
  chars: number;
  /** True when the pass stopped at its limit with more waiting. */
  more: boolean;
}

export interface ArchiveOptions {
  /** Only pages fetched before this; the scans read new ones first. */
  before: Date;
  /** Pages per pass. */
  limit?: number;
  /** Uploads in flight. */
  width?: number;
}

/**
 * Move up to `limit` inline pages fetched before `before` to the store. Upload
 * first, then clear the column in one row update, so a crash leaves at worst an
 * object that the next pass overwrites with the same bytes.
 */
export async function archivePages(
  db: Queryable,
  store: PageStore,
  opts: ArchiveOptions,
): Promise<ArchiveStats> {
  const limit = opts.limit ?? 500;
  const width = opts.width ?? 8;
  const rows = await db
    .select({ id: documents.id, html: documents.html })
    .from(documents)
    .where(and(isNotNull(documents.html), lt(documents.fetchedAt, opts.before)))
    .orderBy(asc(documents.id))
    .limit(limit);
  const stats: ArchiveStats = { moved: 0, chars: 0, more: rows.length === limit };
  let next = 0;
  const one = async () => {
    for (let i = next++; i < rows.length; i = next++) {
      const { id, html } = rows[i] as { id: number; html: string };
      const key = pageKey(id);
      await store.put(key, html);
      const done = await db
        .update(documents)
        .set({ html: null, htmlKey: key, telHrefs: telHrefs(html) })
        .where(and(eq(documents.id, id), isNotNull(documents.html)))
        .returning({ id: documents.id });
      if (done.length === 0) continue;
      stats.moved += 1;
      stats.chars += html.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, rows.length) }, one));
  return stats;
}

/** Pages still inline, and archived: for status lines. */
export async function pageCounts(db: Queryable): Promise<{ inline: number; archived: number }> {
  const [row] = await db
    .select({
      inline: sql<number>`count(*) FILTER (WHERE ${documents.html} IS NOT NULL)::int`,
      archived: sql<number>`count(*) FILTER (WHERE ${documents.htmlKey} IS NOT NULL)::int`,
    })
    .from(documents);
  return row ?? { inline: 0, archived: 0 };
}

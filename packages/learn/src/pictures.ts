/**
 * Learn's pictures in our own store. A thumbnail or avatar that a feed, creator or page named is
 * copied once, on the Monitor's pass, and the row then names the stored copy (`s3://bucket/key`).
 * Opening Learn never asks Instagram or YouTube for a picture, and an Instagram address, which
 * expires, stops mattering once it is kept. Episode audio stays at its host: it is large and seeks.
 */
import * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FetchFn } from "./feeds.js";
import { items, sources } from "./schema.js";

/** Bytes in, a stored ref out; a stored ref to an address good for a short while. */
export interface PictureStore {
  put(bytes: Uint8Array, ext: string): Promise<string>;
  sign(ref: string): Promise<string>;
}

/** Pictures one pass copies, newest items first. */
export const PICTURES_PER_PASS = 60;
const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

export const isStoredPicture = (u: string | null | undefined): u is string =>
  !!u?.startsWith("s3://");

export interface PictureStats {
  kept: number;
  /** Gone at their host (404, expired): the row drops the address. */
  gone: number;
  /** A host that failed this time; the next pass tries again. */
  failed: number;
}

/** The addresses still at their host: items' thumbnails, newest first, then sources' avatars. */
async function waiting(db: Db, limit: number): Promise<string[]> {
  const rows = await db.execute<{ url: string }>(sql`
    select url from (
      select ${items.thumbnailUrl} as url, max(${items.createdAt}) as at from ${items}
        where ${items.thumbnailUrl} like 'https://%' group by 1
      union all
      select ${sources.avatarUrl}, max(${sources.createdAt}) from ${sources}
        where ${sources.avatarUrl} like 'https://%' group by 1
    ) w order by at desc limit ${limit}`);
  return [...new Set(rows.map((r) => r.url))];
}

/** Every row that names `url` names `to` instead. */
async function repoint(db: Db, url: string, to: string | null) {
  await db.update(items).set({ thumbnailUrl: to }).where(eq(items.thumbnailUrl, url));
  await db.update(sources).set({ avatarUrl: to }).where(eq(sources.avatarUrl, url));
}

/** One picture: the stored ref, "gone" when its host says it no longer exists, null on a miss. */
async function fetchPicture(
  fetchFn: FetchFn,
  url: string,
): Promise<{ bytes: Uint8Array; ext: string } | "gone" | null> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: {
        accept: "image/avif,image/webp,image/*;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; WrenLearn/1.0)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if ([400, 403, 404, 410].includes(res.status)) return "gone";
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXT[type];
  if (!ext) return "gone";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return "gone";
  return { bytes, ext };
}

/** Copies the pictures still at their host into the store and points their rows at the copy. */
export async function keepPictures(
  db: Db,
  store: PictureStore,
  fetchFn: FetchFn = fetch,
  limit = PICTURES_PER_PASS,
): Promise<PictureStats> {
  const stats: PictureStats = { kept: 0, gone: 0, failed: 0 };
  for (const url of await waiting(db, limit)) {
    const got = await fetchPicture(fetchFn, url);
    if (got === null) {
      stats.failed++;
      continue;
    }
    if (got === "gone") {
      await repoint(db, url, null);
      stats.gone++;
      continue;
    }
    try {
      await repoint(db, url, await store.put(got.bytes, got.ext));
      stats.kept++;
    } catch {
      stats.failed++;
    }
  }
  return stats;
}

/** A stored picture's GET address, when a Learn row names it; null for anything else. */
export async function signPicture(
  db: Db,
  store: PictureStore,
  ref: string,
): Promise<string | null> {
  if (!isStoredPicture(ref)) return null;
  const [named] = await db.execute<{ one: number }>(sql`
    select 1 as one where exists (select 1 from ${items} where ${items.thumbnailUrl} = ${ref})
      or exists (select 1 from ${sources} where ${sources.avatarUrl} = ${ref})`);
  return named ? store.sign(ref) : null;
}

/**
 * `LearnPictures/sign`: the portal's Worker, on a cache miss, asks for a stored picture's address.
 * It already checked the viewer's grant; this answers only for refs a Learn row names.
 */
export function makeLearnPictures(db: Db, store: PictureStore | null) {
  return restate.service({
    name: "LearnPictures",
    handlers: {
      sign: serviceHandler(
        { input: z.looseObject({ ref: z.string().max(300).describe("A kept picture: s3://…") }) },
        async (_: restate.Context, req: { ref: string }): Promise<{ url: string | null }> => ({
          url: store ? await signPicture(db, store, req.ref) : null,
        }),
      ),
    },
  });
}

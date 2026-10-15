/**
 * A picture for each row of a card view (`RecordType.thumbs`): a draft's image, else its poster
 * (thumbnail or cover), else its video; a recording's picked thumbnail, else its first, else a
 * cover, else its preview. Stored objects are signed, a URL is kept, a desk path has none.
 */
import { fieldViews } from "@wren/core/content/shapes";
import type { Thumb } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { videoEdits } from "@wren/studio/schema";
import { inArray } from "drizzle-orm";
import { contentDrafts } from "./schema.js";
import { numbered, type VideoSigner } from "./video.js";

const UUID = /^[0-9a-f-]{36}$/i;
type Sign = (source: string | null | undefined) => Promise<string | null>;

/** A link the browser can open: a URL as is, a stored object signed, anything else none. */
export const signerOf =
  (signer: VideoSigner | undefined): Sign =>
  async (source) => {
    if (!source) return null;
    if (/^https:\/\//i.test(source)) return source;
    if (!signer || /^\/|^[a-z]:\\/i.test(source)) return null;
    const at = /^s3:\/\//i.test(source) ? source : `s3://${signer.bucket}/${source}`;
    return signer.host.host(at).catch(() => null);
  };

/** What a draft's card shows, best first: its image, its poster, its first file, its video. */
export function draftPicture(d: {
  platform: Parameters<typeof fieldViews>[0];
  extra: Readonly<Record<string, unknown>>;
  title: string | null;
  media: { kind: "image" | "video"; source: string } | null;
}): { source: string; kind: Thumb["kind"] } | null {
  if (d.media?.kind === "image") return { source: d.media.source, kind: "image" };
  const fields = fieldViews(d.platform, d.extra, d.title);
  const still = fields.find((f) => f.input === "image" && typeof f.value === "string" && f.value);
  if (still) return { source: String(still.value), kind: "image" };
  const files = fields.find((f) => f.input === "files" && Array.isArray(f.value) && f.value[0]);
  if (files && Array.isArray(files.value)) return { source: String(files.value[0]), kind: "image" };
  return d.media ? { source: d.media.source, kind: d.media.kind } : null;
}

/** Drafts' pictures by draft id. */
export async function draftThumbs(
  db: Queryable,
  ids: readonly string[],
  signer?: VideoSigner,
): Promise<Record<string, Thumb>> {
  const want = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (!want.length) return {};
  const sign = signerOf(signer);
  const rows = await db
    .select({
      id: contentDrafts.id,
      platform: contentDrafts.platform,
      extra: contentDrafts.extra,
      title: contentDrafts.title,
      media: contentDrafts.media,
    })
    .from(contentDrafts)
    .where(inArray(contentDrafts.id, want));
  const out: Record<string, Thumb> = {};
  await Promise.all(
    rows.map(async (d) => {
      const pic = draftPicture({ ...d, extra: d.extra ?? {}, media: d.media ?? null });
      const url = await sign(pic?.source);
      if (pic && url) out[d.id] = { url, kind: pic.kind };
    }),
  );
  return out;
}

/** The S3 key of a recording's picture, best first, and whether it plays. */
export function videoPicture(e: {
  files: Record<string, string>;
  keys: Record<string, string>;
}): { source: string; kind: Thumb["kind"] } | null {
  const files = numbered(e.files, "thumb");
  const keys = numbered(e.keys, "thumb");
  const at = e.files.thumbnailPick ? files.indexOf(e.files.thumbnailPick) : -1;
  const still = keys[at] ?? keys[0];
  if (still) return { source: still, kind: "image" };
  const cover = Object.entries(e.keys).find(([k]) => k.startsWith("cover-"))?.[1];
  if (cover) return { source: cover, kind: "image" };
  const preview = e.keys.long ?? e.keys.preview;
  return preview ? { source: preview, kind: "video" } : null;
}

/** Recordings' pictures by id. */
export async function videoThumbs(
  db: Queryable,
  ids: readonly string[],
  signer?: VideoSigner,
): Promise<Record<string, Thumb>> {
  const want = [...new Set(ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!want.length) return {};
  const sign = signerOf(signer);
  const rows = await db
    .select({ id: videoEdits.id, files: videoEdits.files, keys: videoEdits.keys })
    .from(videoEdits)
    .where(inArray(videoEdits.id, want));
  const out: Record<string, Thumb> = {};
  await Promise.all(
    rows.map(async (e) => {
      const pic = videoPicture(e);
      const url = await sign(pic?.source);
      if (pic && url) out[String(e.id)] = { url, kind: pic.kind };
    }),
  );
  return out;
}

/**
 * Pictures for rows whose ids carry what they point at (`draft:<id>`, `video:<id>`, a post's
 * `<platform>/<n>/<draft id>`): `read` names the draft or video an id stands for.
 */
export function mixedThumbs(
  read: (id: string) => { draft: string } | { video: string } | null,
  signer?: VideoSigner,
) {
  return async (db: Queryable, ids: readonly string[]): Promise<Record<string, Thumb>> => {
    const to = new Map(ids.map((id) => [id, read(id)] as const));
    const drafts = [...to.values()].flatMap((t) => (t && "draft" in t ? [t.draft] : []));
    const videos = [...to.values()].flatMap((t) => (t && "video" in t ? [t.video] : []));
    const [d, v] = await Promise.all([
      draftThumbs(db, drafts, signer),
      videoThumbs(db, videos, signer),
    ]);
    const out: Record<string, Thumb> = {};
    for (const [id, t] of to) {
      const got = t && ("draft" in t ? d[t.draft] : v[t.video]);
      if (got) out[id] = got;
    }
    return out;
  };
}

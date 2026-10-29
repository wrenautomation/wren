/**
 * Stories (Marketing → Write's Story box): a photo he uploads, or a clip already cut, as a story on
 * Instagram and the Facebook Page at once. No words ride on it: the APIs take none. Each platform
 * gets a draft of kind `story` on one idea. A photo goes to the media store under its hash, PUT
 * there by the browser (`storyUpload` signs it); a clip
 * is a Reel's stored file, so the APIs fetch it by a signed link.
 */
import type { Media } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DraftResult } from "./draft.js";
import { addIdea } from "./ideas.js";
import { type MediaStoreOptions, signMediaPut, storedHead } from "./media.js";
import { contentDrafts, contentIdeas } from "./schema.js";
import { OWN_WORDS } from "./write.js";

export const STORY_PLATFORMS = ["instagram", "facebook"] as const;
export type StoryPlatform = (typeof STORY_PLATFORMS)[number];

/** The same 2 MB as a field's file. */
export const STORY_PHOTO_MAX = 2 * 1024 * 1024;
const PHOTOS: Record<string, { ext: string; magic: number[] }> = {
  ".jpg": { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  ".jpeg": { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  ".png": { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },
};

function photoKind(name: string, size: number) {
  const dot = name.lastIndexOf(".");
  const kind = PHOTOS[dot < 0 ? "" : name.slice(dot).toLowerCase()];
  if (!kind) throw new Error("A story photo is a JPG or PNG");
  if (size === 0) throw new Error("The photo is empty");
  if (size > STORY_PHOTO_MAX) throw new Error("A story photo is up to 2 MB");
  return kind;
}

/** The stored extension of a story photo, or why it isn't one. `head`: its first bytes. */
export function storyPhotoOf(name: string, head: Uint8Array, size = head.length): string {
  const kind = photoKind(name, size);
  if (!kind.magic.every((b, i) => head[i] === b))
    throw new Error(`The photo isn't the ${kind.ext.slice(1).toUpperCase()} its name says`);
  return kind.ext;
}

/** Where the browser PUTs a story photo, checked by name and size first. */
export function storyUpload(
  store: MediaStoreOptions,
  photo: { name: string; size: number; sha256: string },
) {
  const { ext } = photoKind(photo.name, photo.size);
  const type = ext === ".png" ? "image/png" : "image/jpeg";
  return signMediaPut(store, { sha256: photo.sha256, ext, type, size: photo.size });
}

export interface StoryClip {
  draftId: string;
  title: string;
  at: string;
}

/**
 * Clips a story can share: Reels with a stored file, approved or posted, newest first, one per
 * file. A Short's file sits on the Mac, so its Reel stands for it.
 */
export async function storyClips(db: Queryable, limit = 12): Promise<StoryClip[]> {
  const rows = await db
    .select({
      id: contentDrafts.id,
      title: contentDrafts.title,
      text: contentDrafts.text,
      idea: contentIdeas.text,
      source: sql<string>`${contentDrafts.media}->>'source'`,
      at: sql<string>`coalesce(${contentDrafts.publishedAt}, ${contentDrafts.createdAt})`,
    })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(
      and(
        eq(contentDrafts.platform, "instagram"),
        inArray(contentDrafts.status, ["approved", "publishing", "published"]),
        sql`${contentDrafts.media}->>'kind' = 'video'`,
        sql`${contentDrafts.media}->>'source' like 's3://%'`,
        sql`coalesce(${contentDrafts.extra}->>'kind', 'video') = 'video'`,
      ),
    )
    .orderBy(desc(sql`coalesce(${contentDrafts.publishedAt}, ${contentDrafts.createdAt})`))
    .limit(limit * 3);
  const seen = new Set<string>();
  const out: StoryClip[] = [];
  for (const r of rows) {
    if (seen.has(r.source) || out.length >= limit) continue;
    seen.add(r.source);
    const words = (r.title ?? r.text ?? r.idea).split("\n").find((l) => l.trim()) ?? "";
    out.push({ draftId: r.id, title: words.trim().slice(0, 80) || "A clip", at: String(r.at) });
  }
  return out;
}

/** One story on each platform from a photo or a clip; answers the idea and a result per platform. */
export async function writeStory(
  db: Queryable,
  store: MediaStoreOptions | null,
  o: {
    platforms: readonly StoryPlatform[];
    /** `source`: the `s3://` ref `storyUpload` answered, once the PUT is done. */
    photo?: { name: string; source: string } | null;
    clip?: string | null;
  },
): Promise<{ ideaId: string; results: DraftResult[] }> {
  if (Boolean(o.photo) === Boolean(o.clip)) throw new Error("A story is a photo or a clip");
  let media: Media;
  let about: string;
  if (o.photo) {
    if (!store) throw new Error("No media store here");
    const { size, head } = await storedHead(store, o.photo.source);
    if (!o.photo.source.endsWith(storyPhotoOf(o.photo.name, head, size)))
      throw new Error("The photo isn't the one its name says");
    media = { kind: "image", source: o.photo.source };
    about = `Story: ${o.photo.name}`;
  } else {
    const [c] = await db
      .select({ media: contentDrafts.media, title: contentDrafts.title, text: contentDrafts.text })
      .from(contentDrafts)
      .where(eq(contentDrafts.id, o.clip as string))
      .limit(1);
    if (c?.media?.kind !== "video" || !c.media.source.startsWith("s3://"))
      throw new Error("That clip has no stored video");
    media = { kind: "video", source: c.media.source };
    const words = (c.title ?? c.text).split("\n").find((l) => l.trim()) ?? "a clip";
    about = `Story: ${words.trim().slice(0, 100)}`;
  }
  const idea = await addIdea(db, about, "cli", media);
  const results: DraftResult[] = [];
  for (const platform of o.platforms) {
    const [draft] = await db
      .insert(contentDrafts)
      .values({
        ideaId: idea.id,
        platform,
        text: "",
        media,
        extra: { kind: "story" },
        promptVersion: OWN_WORDS,
      })
      .returning();
    if (!draft) throw new Error("insert returned no row");
    results.push({ platform, ok: true, draft });
  }
  await db.update(contentIdeas).set({ status: "drafted" }).where(eq(contentIdeas.id, idea.id));
  return { ideaId: idea.id, results };
}

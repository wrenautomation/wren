/**
 * A draft as the field editor and the platform preview draw it (designs/2026-10-07-post-shapes.md):
 * its fields with their UI, its words, and a short-lived link for each stored file (thumbnail,
 * cover, the video). Published, it is what went out, with what the platform refused after.
 */
import type { Platform } from "@wren/core/content";
import { type FieldView, fieldViews, kindOf } from "@wren/core/content/shapes";
import type { Queryable } from "@wren/db";
import { eq } from "drizzle-orm";
import { PLATFORM_SPECS } from "./platforms.js";
import { contentDrafts, type DraftStatus } from "./schema.js";
import type { VideoSigner } from "./video.js";

export interface ShapeView {
  draftId: string;
  platform: Platform;
  site: string;
  kind: string;
  status: DraftStatus;
  /** Fields may change: not posting, posted or rejected. */
  editable: boolean;
  title: string | null;
  text: string;
  max: number;
  fields: FieldView[];
  /** A link to see each stored file by its field's key; "media" is the post's own file. */
  links: Record<string, string>;
  media: { kind: "image" | "video"; name: string } | null;
  /** When it posts, once approved with a time. */
  scheduled: string | null;
  /** Posted: where, when, and what the platform refused after it went up. */
  published: { url: string | null; at: string | null; notes: string | null } | null;
}

const EDITABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];
const nameOf = (source: string) => source.slice(source.lastIndexOf("/") + 1);

/** A link the browser can open: a stored object signed, a URL as is, a desk path none. */
async function linkOf(source: unknown, signer: VideoSigner | undefined): Promise<string | null> {
  if (typeof source !== "string" || !source) return null;
  if (/^https:\/\//i.test(source)) return source;
  if (!/^s3:\/\//i.test(source) || !signer) return null;
  return signer.host.host(source).catch(() => null);
}

export async function shapeView(
  db: Queryable,
  draftId: string,
  signer?: VideoSigner,
): Promise<ShapeView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return null;
  const [d] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, draftId)).limit(1);
  if (!d) return null;
  const spec = PLATFORM_SPECS[d.platform];
  const fields = fieldViews(d.platform, d.extra, d.title);
  const links: Record<string, string> = {};
  for (const f of fields)
    if (f.input === "image" || f.input === "captions") {
      const url = await linkOf(f.value, signer);
      if (url) links[f.key] = url;
    }
  const media = await linkOf(d.media?.source, signer);
  if (media) links.media = media;
  const posted = d.status === "published";
  return {
    draftId: d.id,
    platform: d.platform,
    site: spec.name,
    kind: kindOf(d.extra),
    status: d.status,
    editable: EDITABLE.includes(d.status),
    title: d.title,
    text: d.text,
    max: spec.maxChars,
    fields,
    links,
    media: d.media ? { kind: d.media.kind, name: d.media.title || nameOf(d.media.source) } : null,
    scheduled: d.scheduledFor?.toISOString() ?? null,
    published: posted
      ? { url: d.url, at: d.publishedAt?.toISOString() ?? null, notes: d.error }
      : null,
  };
}

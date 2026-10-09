/**
 * A file on a post's field (designs/2026-10-07-post-shapes.md): YouTube's thumbnail and
 * subtitles, a Reel's cover, a LinkedIn image or PDF, X's images. The portal sends the bytes in the call (2 MB at most, so no bucket
 * CORS is needed); they go to the media store under their hash and the field takes the
 * `s3://` key, through `setFields` so the draft record keeps the change.
 */
import { SHAPES } from "@wren/core/content/shapes";
import type { Queryable } from "@wren/db";
import { type MediaStoreOptions, putMedia } from "./media.js";
import { getDraft, setFields } from "./review.js";
import type { ContentDraft } from "./schema.js";

/** Bytes a call carries, as base64: the cap every file field shares. */
export const ATTACH_MAX_BYTES = 2 * 1024 * 1024;

const KINDS: Record<string, { ext: string; type: string; magic?: number[] }> = {
  ".jpg": { ext: ".jpg", type: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  ".jpeg": { ext: ".jpg", type: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  ".png": { ext: ".png", type: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  ".pdf": { ext: ".pdf", type: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  ".srt": { ext: ".srt", type: "application/x-subrip" },
  ".vtt": { ext: ".vtt", type: "text/vtt" },
};

/** The stored extension for this file on this field, or why it isn't taken. */
export function attachmentOf(
  platform: ContentDraft["platform"],
  field: string,
  name: string,
  bytes: Uint8Array,
): string {
  const f = SHAPES[platform].fields.find((x) => x.key === field);
  if (
    !f ||
    (f.input !== "image" && f.input !== "files" && f.input !== "captions") ||
    f.status !== "sent"
  )
    throw new Error(`${platform} takes no file on ${field}`);
  const dot = name.lastIndexOf(".");
  const kind = KINDS[dot < 0 ? "" : name.slice(dot).toLowerCase()];
  if (!kind || !f.accept?.includes(kind.type))
    throw new Error(`${f.label}: ${f.hint ?? "not a file it takes"}`);
  if (bytes.length === 0) throw new Error(`${f.label}: the file is empty`);
  const max = Math.min(f.maxBytes ?? ATTACH_MAX_BYTES, ATTACH_MAX_BYTES);
  if (bytes.length > max) throw new Error(`${f.label}: up to ${max / 1024 / 1024} MB`);
  if (kind.magic && !kind.magic.every((b, i) => bytes[i] === b))
    throw new Error(
      `${f.label}: the file isn't the ${kind.ext.slice(1).toUpperCase()} its name says`,
    );
  return kind.ext;
}

/** Store the file and set it on the draft's field; answers the draft. */
export async function attachFile(
  db: Queryable,
  store: MediaStoreOptions,
  req: { draftId: string; field: string; name: string; data: string },
  who: { by: string },
): Promise<ContentDraft> {
  const draft = await getDraft(db, req.draftId);
  const bytes = Buffer.from(req.data, "base64");
  const ext = attachmentOf(draft.platform, req.field, req.name, bytes);
  const source = await putMedia(bytes, ext, store);
  // A files field adds to the end; its cap is the shape's, checked by setFields.
  const many = SHAPES[draft.platform].fields.find((x) => x.key === req.field)?.input === "files";
  const had = draft.extra?.[req.field];
  const value = many ? [...(Array.isArray(had) ? had : []), source] : source;
  return setFields(db, draft.id, { [req.field]: value }, who);
}

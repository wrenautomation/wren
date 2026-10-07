/**
 * The Library's Media and SOPs (designs/2026-10-06-library-and-views.md, 3), read only. Media:
 * each long cut, Short and thumbnail in the media bucket, with where it went. SOPs: each SOP
 * the content loop holds as a platform's playbook (`wren sop push`), its newest text.
 */
import {
  cued,
  date,
  defineRecord,
  link,
  named,
  number,
  prose,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { videoEdits } from "@wren/studio/schema";
import { desc, eq, like, sql } from "drizzle-orm";
import { contentDrafts, contentIdeas } from "./schema.js";
import { longOf, numbered, type VideoSigner, videoRef } from "./video.js";

const KIND: Record<string, State> = cued({
  video: { label: "Video", tone: "neutral" },
  short: { label: "Short", tone: "neutral" },
  thumbnail: { label: "Thumbnail", tone: "neutral" },
});
const USED: Record<string, State> = {
  published: { label: "Posted", tone: "good" },
  picked: { label: "Picked", tone: "good" },
  draft: { label: "Drafted", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
  unused: { label: "Not used", tone: "neutral" },
};

/** One file in the media bucket: `<video>/<kind>/<n>` (n from 1). */
interface MediaFile {
  id: string;
  video: number;
  videoTitle: string;
  kind: "video" | "short" | "thumbnail";
  name: string;
  key: string;
  used: string;
  url: string | null;
  changed: Date;
}

/** Where a draft went: posted with its link, failed, or still a draft. */
const usedOf = (d: { status: string; url: string | null } | undefined) =>
  !d
    ? "unused"
    : d.status === "published"
      ? "published"
      : d.status === "failed"
        ? "failed"
        : "draft";

async function filesOf(db: Queryable, only?: number): Promise<MediaFile[]> {
  const edits = await db
    .select({
      id: videoEdits.id,
      title: videoEdits.title,
      shorts: videoEdits.shorts,
      files: videoEdits.files,
      keys: videoEdits.keys,
      updated: videoEdits.updatedAt,
    })
    .from(videoEdits)
    .where(only === undefined ? sql`true` : eq(videoEdits.id, only))
    .orderBy(desc(videoEdits.updatedAt));
  if (!edits.length) return [];
  const drafts = await db
    .select({ ref: contentIdeas.ref, status: contentDrafts.status, url: contentDrafts.url })
    .from(contentIdeas)
    .innerJoin(contentDrafts, eq(contentDrafts.ideaId, contentIdeas.id))
    .where(like(contentIdeas.ref, "video:%"));
  const draftOf = (ref: string) => drafts.find((d) => d.ref === ref);
  return edits.flatMap((e) => {
    const videoTitle = e.title || `Video ${e.id}`;
    const base = { video: e.id, videoTitle, changed: e.updated };
    const out: MediaFile[] = [];
    const long = longOf(e.keys);
    if (long) {
      const d = draftOf(videoRef(e.id));
      out.push({
        ...base,
        id: `${e.id}/video/1`,
        kind: "video",
        name: videoTitle,
        key: long,
        used: usedOf(d),
        url: d?.url ?? null,
      });
    }
    numbered(e.keys, "short").forEach((key, i) => {
      const d = draftOf(videoRef(e.id, i + 1));
      out.push({
        ...base,
        id: `${e.id}/short/${i + 1}`,
        kind: "short",
        name: e.shorts[i]?.title || `Short ${i + 1}`,
        key,
        used: usedOf(d),
        url: d?.url ?? null,
      });
    });
    const thumbFiles = numbered(e.files, "thumb");
    const picked = e.files.thumbnailPick ?? thumbFiles[0];
    numbered(e.keys, "thumb").forEach((key, i) => {
      out.push({
        ...base,
        id: `${e.id}/thumbnail/${i + 1}`,
        kind: "thumbnail",
        name: `Thumbnail ${i + 1}`,
        key,
        used: picked && picked === thumbFiles[i] ? "picked" : "unused",
        url: null,
      });
    });
    return out;
  });
}

/** Media: every rendered file, and where it went. Its page plays or shows the file, signed. */
export const mediaRecord = (signer?: VideoSigner) =>
  defineRecord({
    id: "library.media",
    app: "library",
    channel: null,
    name: { one: "file", many: "media" },
    rows: async (db) =>
      (await filesOf(db)).map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        video: f.videoTitle,
        used: f.used,
        url: f.url,
        changed: f.changed.toISOString(),
      })),
    key: "id",
    title: "name",
    subtitle: "video",
    fields: {
      name: text("Name"),
      kind: status(KIND, "Kind"),
      video: text("From"),
      used: status(USED, "Used"),
      url: link("Where it went"),
      changed: date("Changed"),
    },
    views: [{ id: "all", label: "All", sort: "-changed", at: "changed" }],
    /** The file, signed for a while: played or shown on its page. */
    load: async (db, id) => {
      const video = Number(id.split("/")[0]);
      if (!Number.isSafeInteger(video)) return null;
      const f = (await filesOf(db, video)).find((x) => x.id === id);
      if (!f) return null;
      const src =
        !signer || !f.key
          ? null
          : await signer.host.host(
              f.key.startsWith("s3://") ? f.key : `s3://${signer.bucket}/${f.key}`,
            );
      return { media: { kind: f.kind, src, video: f.video } };
    },
  });

const PLATFORM: Record<string, State> = cued({
  youtube: { label: "YouTube", tone: "neutral" },
  linkedin: { label: "LinkedIn", tone: "neutral" },
  x: { label: "X", tone: "neutral" },
  instagram: { label: "Instagram", tone: "neutral" },
  facebook: { label: "Facebook", tone: "neutral" },
  tiktok: { label: "TikTok", tone: "neutral" },
  reddit: { label: "Reddit", tone: "neutral" },
});

/** SOPs: the newest text of each SOP the content loop follows, with how many times it changed. */
export const sopRecord = defineRecord({
  id: "library.sop",
  app: "library",
  channel: null,
  name: { one: "SOP", many: "SOPs" },
  // A few dozen SOPs at most: read as rows, queried as a table.
  rows: async (db) =>
    (await db.execute(sql`
      SELECT DISTINCT ON (platform, sop) platform || '/' || sop AS id, sop, platform, text,
        count(*) OVER (PARTITION BY platform, sop)::int AS versions, created_at AS pushed
      FROM content_playbooks
      ORDER BY platform, sop, created_at DESC`)) as unknown as Record<string, unknown>[],
  key: "id",
  title: "sop",
  subtitle: "platform",
  fields: {
    sop: named("SOP"),
    platform: status(PLATFORM, "Platform"),
    text: prose("Words"),
    versions: number("Versions"),
    pushed: date("Pushed"),
  },
  views: [{ id: "all", label: "All", sort: "sop", at: "pushed" }],
});

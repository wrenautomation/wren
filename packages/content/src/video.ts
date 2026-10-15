/**
 * Marketing → Videos (designs/2026-10-06-video-editor.md, Where it shows, Upload): each
 * `video_edits` row as a record, and Approve. Approve is William's yes: it writes a YouTube draft
 * whose media is the rendered file on the Mac, approved to go at once, private. The desk (the Mac)
 * reads the file from its own disk, so nothing uploads without his click.
 */
import { finishRun, openRun } from "@wren/core";
import type { Platform } from "@wren/core/content";
import { fieldsOf, YOUTUBE_PRIVACY } from "@wren/core/content/shapes";
import { recordDraft } from "@wren/core/draft-record";
import { date, defineRecord, link, number, type State, status, text } from "@wren/core/records";
import { renderKind, type Template } from "@wren/core/slots";
import type { TemplateRef } from "@wren/core/templates";
import { liveOrDefault } from "@wren/core/templates/defaults";
import { atomic, type Queryable } from "@wren/db";
import { keepSegments, onCut, reviewCuts } from "@wren/studio/cuts";
import {
  type CaptionLine,
  CROPPED,
  type CroppedFormat,
  captionLines,
  coverMs,
  formatFor,
  pictureOf,
} from "@wren/studio/finish";
import { changedSince } from "@wren/studio/hash";
import { type Cut, type VideoEdit, videoEdits, type Word } from "@wren/studio/schema";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { promosOf, videoDraftOf } from "./promo.js";
import { contentDrafts, contentIdeas, type DraftStatus, type IdeaSource } from "./schema.js";
import { videoThumbs } from "./thumbs.js";
import { videoTurns } from "./video-ask.js";
import {
  previewCheck,
  renderTimes,
  type VideoStep,
  videoChecks,
  videoName,
  videoState,
  videoSteps,
} from "./video-edit.js";

/** The idea's ref: one draft per video, per Short and per vertical cut, ever. */
export const videoRef = (id: number, short?: number | "vertical") =>
  short === "vertical"
    ? `video:${id}/vertical`
    : short
      ? `video:${id}/short:${short}`
      : `video:${id}`;

const YT_DESCRIPTION = 5000;
const VIDEO_GONE = "That video isn't here any more. Reload the page to see what's left.";

/**
 * The footer under each upload's words: `post` templates (packages/templates/defaults/post),
 * edited through the template store like any copy. `long` under a YouTube video's description,
 * `short` under a Short's (links there can't be clicked), `reel` under a Reel's caption.
 */
export const VIDEO_FOOTERS = {
  long: { kind: "post", system: "youtube", name: "footer" },
  short: { kind: "post", system: "youtube", name: "shorts-footer" },
  reel: { kind: "post", system: "instagram", name: "reel-footer" },
} as const satisfies Record<string, TemplateRef>;
export type VideoFooter = keyof typeof VIDEO_FOOTERS;

/**
 * The video in a link's `utm_campaign` (`/go/yt/<slug>`): its id, then its title's first words,
 * lowercase with dashes, 40 characters at most. The id keeps it unique when titles repeat.
 */
export function videoSlug(e: Pick<VideoEdit, "id" | "title">): string {
  const words = e.title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let slug = String(e.id);
  for (const w of words) {
    if (slug.length + 1 + w.length > 40) break;
    slug += `-${w}`;
  }
  return slug;
}

/** A footer's words with the video's slots filled. */
export const fillFooter = (tpl: Template | null, e: Pick<VideoEdit, "id" | "title">): string =>
  tpl ? renderKind("post", tpl, { video: videoSlug(e) }, `video:${e.id}`).body : "";

/**
 * Each footer's live words; null when its template was emptied. A database that never took one
 * gets its default first, following it, so this runs outside the caller's transaction: that
 * write sets its own audit actor.
 */
export async function videoFooters(db: Queryable): Promise<Record<VideoFooter, Template | null>> {
  const out = {} as Record<VideoFooter, Template | null>;
  for (const k of Object.keys(VIDEO_FOOTERS) as VideoFooter[])
    out[k] = (await liveOrDefault(db, VIDEO_FOOTERS[k]))?.template ?? null;
  return out;
}

/** The words, then the footer, blank lines between, `max` long; the footer is never cut off. */
export function withFooter(parts: string[], footer: string, max: number): string {
  const tail = footer.trim();
  const room = max - (tail ? tail.length + 2 : 0);
  const head = parts.filter(Boolean).join("\n\n").slice(0, Math.max(0, room));
  return [head, tail].filter(Boolean).join("\n\n");
}

/**
 * Outputs named `<prefix><n>` in order of their number, for lists. Studio's `renderAll` names them
 * `short-<n>` and `thumb-<n>`, 1-based; one output is looked up by that exact name.
 */
export function numbered(rec: Record<string, string>, prefix: "short" | "thumb"): string[] {
  const re = prefix === "short" ? /^shorts?[-_]?(\d+)$/i : /^thumb(?:nail)?s?[-_]?(\d+)$/i;
  return Object.entries(rec)
    .flatMap(([k, v]) => {
      const m = re.exec(k);
      return m ? [[Number(m[1]), v] as const] : [];
    })
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/** The rendered long video: `long`, else `preview` (S3 keys). */
export const longOf = (rec: Record<string, string>): string | null =>
  rec.long ?? rec.preview ?? null;

/** Seconds the applied cuts take out. */
export const cutSeconds = (cuts: readonly Cut[]) =>
  cuts.filter((c) => c.state === "cut").reduce((s, c) => s + (c.to - c.from), 0);

export const clock = (s: number) => {
  const r = Math.max(0, Math.round(s));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
};

/**
 * The chapters as YouTube reads them in a description, on the cut timeline: `0:00 Intro` lines,
 * the first forced to 0:00. None when YouTube would ignore them (under 3, or two under 10 s apart).
 */
export function chapterLines(e: Pick<VideoEdit, "chapters" | "cuts" | "tracks">): string {
  const keep = keepSegments(e.cuts, e.tracks.main.durationS);
  const marks = e.chapters
    .map((c) => ({ at: Math.round(onCut(c.at, keep)), title: c.title.trim() }))
    .sort((a, b) => a.at - b.at)
    .map((c, i) => (i ? c : { ...c, at: 0 }));
  const close = marks.some((c, i) => i > 0 && c.at - (marks[i - 1]?.at ?? 0) < 10);
  if (marks.length < 3 || close) return "";
  return marks.map((c) => `${clock(c.at)} ${c.title}`).join("\n");
}

/**
 * Each word with the cut over its middle (applied, proposed in yellow, or none) and whether it's
 * stressed (`wren video stress`).
 */
export function markWords(
  words: readonly Word[],
  cuts: readonly Cut[],
  stress: readonly number[] = [],
) {
  const live = cuts.filter((c) => c.state !== "kept");
  const stressed = new Set(stress);
  return words.map((w, i) => {
    const mid = (w.s + w.e) / 2;
    const c = live.find((x) => mid >= x.from && mid < x.to);
    return { w: w.w, s: w.s, e: w.e, cut: c ? c.state : null, stress: stressed.has(i) };
  });
}

/** Who sees the upload on YouTube. */
export const VIDEO_PRIVACY = YOUTUBE_PRIVACY;
export type VideoPrivacy = (typeof VIDEO_PRIVACY)[number];

export interface ApproveVideo {
  short?: number;
  /** The whole cut, 9:16 (`files.vertical`); a video whose formats lack `long` takes it anyway. */
  vertical?: boolean;
  /** Private unless he says otherwise: then he publishes or schedules it on YouTube. */
  privacy?: VideoPrivacy;
  /** When YouTube makes it public: it uploads now, private, until then (designs/2026-10-13-video-review.md). */
  publishAt?: Date;
  /** Upload at this time instead of on the next pass (a Short's slot); `privacy` is who sees it then. */
  at?: Date;
  /** The long video, already uploaded: upload the current render as a new video. The old draft keeps its URL. */
  replace?: boolean;
  /** How Wren's TikTok posts go out (`tiktokPostVia`): `web` drafts public with every interaction on. Default `api`. */
  tiktokVia?: "web" | "api";
  source: IdeaSource;
  now?: Date;
}

export interface ApprovedVideo {
  /** The YouTube draft. */
  id: string;
  again: boolean;
  /**
   * A Short or the vertical only: its Instagram Reel draft, waiting in To approve (`id`), or why there is none
   * (`missing`: rendered before Reels were uploaded).
   */
  reel?: { id: string; again: boolean } | { missing: string };
  /** The TikTok, X, Facebook and LinkedIn drafts of the same render this call made, in To approve. */
  also?: { platform: string; id: string }[];
}

/** IG captions stop at 2,200 characters. */
const IG_CAPTION = 2200;
/** YouTube files a vertical this long or shorter as a Short: no custom thumbnail. */
const SHORT_MAX_S = 180;

/**
 * His yes on the long video, Short `short` (1-based) or the vertical cut: a YouTube draft, approved
 * to go on the next pass, private. A Short or the vertical also gets an Instagram Reel draft of the same render, from the
 * media bucket (Graph fetches a URL), and TikTok, X, Facebook and LinkedIn drafts of it, waiting in
 * To approve: they post only on his Approve there. Approving the same one again answers its drafts
 * and adds only the missing ones.
 */
export async function approveVideo(
  db: Queryable,
  id: number,
  o: ApproveVideo,
): Promise<ApprovedVideo> {
  if (o.publishAt && o.publishAt.getTime() <= (o.now ?? new Date()).getTime() + 15 * 60_000)
    throw new Error("Pick a time at least 15 minutes from now.");
  const footers = await videoFooters(db);
  return atomic(db, async (tx) => {
    const [e] = await tx.select().from(videoEdits).where(eq(videoEdits.id, id)).for("update");
    if (!e) throw new Error(VIDEO_GONE);
    // A vertical-only recording: his yes (the Inbox's too) is on the vertical cut.
    const vertical = !o.short && (o.vertical || !e.formats.includes("long"));
    const reels = vertical ? ("vertical" as const) : o.short;
    const ref = videoRef(id, reels);
    const had = await tx
      .select({ id: contentDrafts.id, platform: contentDrafts.platform, ideaId: contentIdeas.id })
      .from(contentDrafts)
      .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
      .where(eq(contentIdeas.ref, ref));
    const uploaded = had.find((d) => d.platform === "youtube");
    const replace = Boolean(o.replace && uploaded && !reels);
    const yt = replace ? undefined : uploaded;
    const now = o.now ?? new Date();
    if (yt && !reels) return { id: yt.id, again: true };
    // The ref is unique: the old idea steps aside so the new upload takes it (promos find the new one).
    if (replace && uploaded)
      await tx
        .update(contentIdeas)
        .set({ ref: `${ref}~${uploaded.id.slice(0, 8)}` })
        .where(eq(contentIdeas.id, uploaded.ideaId));
    if (!yt && !["rendered", "approved", "uploaded"].includes(e.state))
      throw new Error(
        `${videoName(e)} is ${videoState(e.state)}, so there's no file to post yet: render it first, then approve.`,
      );
    const { file, title, thumbnail } = target(e, reels);
    // The funnel (designs/2026-10-07-content-funnel.md): the long upload builds trust, its footer
    // links the site; a Short or Reel reaches, pointing at the long upload when there is one.
    const long = reels
      ? (
          await tx
            .select({ id: contentDrafts.id })
            .from(contentDrafts)
            .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
            .where(and(eq(contentIdeas.ref, videoRef(id)), eq(contentDrafts.platform, "youtube")))
            .limit(1)
        )[0]
      : undefined;
    const funnel = reels
      ? {
          stage: "reach" as const,
          pointsTo: long ? ("video" as const) : ("site" as const),
          videoDraft: long?.id ?? null,
        }
      : { stage: "trust" as const, pointsTo: "site" as const };
    // YouTube files a vertical of 3 min or less as a Short.
    const kind =
      o.short || (vertical && e.tracks.main.durationS - cutSeconds(e.cuts) <= SHORT_MAX_S)
        ? "short"
        : "video";
    // A Short says what its own clip says; the video's description belongs to the long one.
    const about = typeof reels === "number" ? clipWords(e, reels) || e.description : e.description;
    // Chapters go under the description (a Short has none), then the footer for its kind.
    const body = withFooter(
      [about, kind === "short" ? "" : chapterLines(e)],
      fillFooter(footers[kind === "short" ? "short" : "long"], e),
      YT_DESCRIPTION,
    );
    let ideaId = yt?.ideaId;
    let ytId = yt?.id;
    if (!ideaId || !ytId) {
      const [idea] = await tx
        .insert(contentIdeas)
        .values({
          text: `${title}\n\n${body}`,
          source: o.source,
          ref,
          status: "drafted",
          media: { kind: "video", source: file, title },
        })
        .returning();
      if (!idea) throw new Error("insert returned no idea");
      const [d] = await tx
        .insert(contentDrafts)
        .values({
          ideaId: idea.id,
          platform: "youtube",
          text: body,
          title,
          media: { kind: "video", source: file, title },
          // Its shape (designs/2026-10-07-post-shapes.md): YouTube can't take a Short's thumbnail.
          extra: fieldsOf("youtube", {
            kind,
            privacyStatus: o.publishAt ? "private" : (o.privacy ?? "private"),
            ...(o.publishAt ? { publishAt: o.publishAt.toISOString() } : {}),
            madeForKids: false,
            ...(e.tags.length ? { tags: e.tags } : {}),
            ...(thumbnail && kind === "video" ? { thumbnail } : {}),
            // The long video's English subtitles (render writes them): YouTube's CC track.
            ...(!reels && e.files.captions
              ? { captions: e.files.captions, captionsLanguage: "en" }
              : {}),
          }),
          status: "approved",
          approvedAt: now,
          // Null: the next publish pass.
          scheduledFor: o.at ?? null,
          promptVersion: "video",
          ...funnel,
        })
        .returning({ id: contentDrafts.id });
      if (!d) throw new Error("insert returned no draft");
      await keepUpload(tx, d.id, { video: id, short: reels, text: body, title });
      ideaId = idea.id;
      ytId = d.id;
    }
    if (e.state === "rendered")
      await tx
        .update(videoEdits)
        .set({ state: "approved", updatedAt: now })
        .where(eq(videoEdits.id, id));
    if (!reels) return { id: ytId, again: false };
    const out = { id: ytId, again: Boolean(yt) };
    const reel = had.find((d) => d.platform === "instagram");
    const stored = e.keys[reelKey(reels)];
    if (!stored)
      return {
        ...out,
        reel: {
          missing: vertical
            ? `The vertical has no Reel upload: render it again (wren video render ${id} --only vertical)`
            : `Short ${o.short} has no Reel upload: render it again (wren video render ${id} --short ${o.short})`,
        },
      };
    // The whole cut's cover (finish.ts): his frame, on the cut timeline, and its picture.
    const cover =
      vertical && e.thumbnail
        ? {
            ms: coverMs(e.thumbnail.at, keepSegments(e.cuts, e.tracks.main.durationS, 30)),
            file: e.keys["cover-vertical"] ?? null,
          }
        : null;
    const also = await alsoDrafts(tx, {
      ideaId,
      have: new Set(had.map((d) => d.platform)),
      stored,
      // The whole cut goes to each feed in its shape: LinkedIn and Facebook 4:5, X 1:1, when rendered.
      ...(vertical ? { framed: framedStored(e) } : {}),
      ...(cover ? { coverMs: cover.ms } : {}),
      title,
      description: about,
      video: id,
      short: reels,
      funnel,
      tiktokVia: o.tiktokVia ?? "api",
    });
    if (reel) return { ...out, reel: { id: reel.id, again: true }, also };
    const caption = withFooter([title, about], fillFooter(footers.reel, e), IG_CAPTION);
    const [r] = await tx
      .insert(contentDrafts)
      .values({
        ideaId,
        platform: "instagram",
        text: caption,
        title,
        media: { kind: "video", source: stored, title },
        extra: fieldsOf("instagram", {
          shareToFeed: true,
          ...(cover ? { thumbOffset: cover.ms, ...(cover.file ? { cover: cover.file } : {}) } : {}),
        }),
        // Waits in To approve; his Approve gives it the next Instagram slot.
        status: "draft",
        promptVersion: "video",
        ...funnel,
      })
      .returning({ id: contentDrafts.id });
    if (!r) throw new Error("insert returned no draft");
    await keepUpload(tx, r.id, {
      video: id,
      short: reels,
      text: caption,
      title,
      wait: true,
    });
    return { ...out, reel: { id: r.id, again: false }, also };
  });
}

/** The other vertical platforms a Short or the vertical cut goes to, beside YouTube and Instagram. */
export const ALSO_PLATFORMS = ["tiktok", "x", "facebook", "linkedin"] as const;
type AlsoPlatform = (typeof ALSO_PLATFORMS)[number];

/** TikTok takes a caption up to 2,200 characters; this keeps one in a line or two. */
const ALSO_BODY = 400;

/** What a Short says: its spoken words on the cut timeline, cut at a sentence or a word; "" when it has none. */
export function clipWords(e: Pick<VideoEdit, "words" | "cuts" | "shorts">, n: number): string {
  const clip = e.shorts[n - 1];
  if (!clip) return "";
  const said = markWords(e.words, e.cuts)
    .filter((w) => w.cut !== "cut" && (w.s + w.e) / 2 >= clip.from && (w.s + w.e) / 2 < clip.to)
    .map((w) => w.w.trim())
    .join(" ");
  return tidy(excerpt(said));
}

/** Words with no punctuation (some transcripts) read as a sentence: a capital, "I", a full stop. */
export function tidy(text: string): string {
  const t = text.replace(/\bi(?=\b|')/g, "I");
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return cap && !/[.?!]$|\.\.\.$/.test(cap) ? `${cap}.` : cap;
}

/** Text cut to `max` characters at the last sentence end past its middle, else at a word, with an ellipsis. */
export function excerpt(text: string, max = ALSO_BODY): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (end >= max / 2) return cut.slice(0, end + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}...`;
}

/** The first paragraph of a description, cut at a word, for a caption under the title. */
export function leadOf(description: string, max = ALSO_BODY): string {
  return excerpt(description.trim().split(/\n\s*\n/)[0] ?? "", max);
}

/**
 * The words a clip goes out with on each platform: X and TikTok the title alone, LinkedIn and
 * Facebook the title and the description's first paragraph. Links come at publish time (the funnel).
 */
export function alsoText(platform: AlsoPlatform, title: string, description: string): string {
  if (platform === "x" || platform === "tiktok") return title;
  return [title, leadOf(description)].filter(Boolean).join("\n\n");
}

/**
 * TikTok's fields for a clip. Studio (`web`) posts public with comments, duet and stitch on, the
 * way a post goes out by default; the unaudited API posts only to him, so `api` drafts private
 * with them off.
 */
export function tiktokFields(via: "web" | "api") {
  return fieldsOf(
    "tiktok",
    via === "web"
      ? { privacy: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true, allowStitch: true }
      : { privacy: "SELF_ONLY" },
  );
}

/** The fields each takes; `coverMs` the cover frame, TikTok's only. */
const alsoFields = (platform: AlsoPlatform, tiktokVia: "web" | "api", cover?: number) =>
  platform === "tiktok"
    ? { ...tiktokFields(tiktokVia), ...(cover !== undefined ? { coverMs: cover } : {}) }
    : platform === "x"
      ? fieldsOf("x", {})
      : platform === "facebook"
        ? fieldsOf("facebook", { kind: "video" })
        : fieldsOf("linkedin", { kind: "post" });

/**
 * Drafts of the same render for TikTok, X, Facebook and LinkedIn, each waiting in To approve, for
 * the platforms the clip has none on yet. Returns the ones it made.
 */
async function alsoDrafts(
  db: Queryable,
  o: {
    ideaId: string;
    have: ReadonlySet<string>;
    stored: string;
    title: string;
    description: string;
    video: number;
    short: number | "vertical";
    funnel: { stage: "reach" | "trust"; pointsTo: "video" | "site"; videoDraft?: string | null };
    tiktokVia: "web" | "api";
    /** The whole cut's renders by format, uploaded (`framedStored`): each platform takes its shape. */
    framed?: Partial<Record<CroppedFormat, string>>;
    coverMs?: number;
  },
): Promise<{ platform: AlsoPlatform; id: string }[]> {
  const made: { platform: AlsoPlatform; id: string }[] = [];
  for (const platform of ALSO_PLATFORMS) {
    if (o.have.has(platform)) continue;
    const text = alsoText(platform, o.title, o.description);
    const shape = o.framed ? formatFor(platform, new Set(Object.keys(o.framed))) : null;
    const source = (shape && o.framed?.[shape]) || o.stored;
    const [d] = await db
      .insert(contentDrafts)
      .values({
        ideaId: o.ideaId,
        platform,
        text,
        title: o.title,
        media: { kind: "video", source, title: o.title },
        extra: alsoFields(platform, o.tiktokVia, o.coverMs),
        status: "draft",
        promptVersion: "video",
        ...o.funnel,
      })
      .returning({ id: contentDrafts.id });
    if (!d) throw new Error("insert returned no draft");
    await keepUpload(db, d.id, {
      video: o.video,
      short: o.short,
      text,
      title: o.title,
      wait: true,
      platform,
    });
    made.push({ platform, id: d.id });
  }
  return made;
}

/**
 * A video's upload draft in the draft record: its words, from the video's own (`video:<id>` keeps
 * their versions), and his yes unless it waits for one in To approve (a Reel).
 */
async function keepUpload(
  db: Queryable,
  draftId: string,
  o: {
    video: number;
    short?: number | "vertical" | undefined;
    text: string;
    title: string;
    wait?: boolean;
    /** Where a waiting draft goes; Instagram's Reel unless said. */
    platform?: Platform;
  },
) {
  const meta = {
    video: o.video,
    ...(o.short === "vertical" ? { vertical: true } : o.short ? { short: o.short } : {}),
  };
  const item = `draft:${draftId}`;
  await recordDraft(db, {
    item,
    kind: "video",
    platform: o.wait ? (o.platform ?? "instagram") : "youtube",
    event: "generated",
    via: "wren",
    text: o.text,
    title: o.title,
    meta,
  });
  if (!o.wait)
    await recordDraft(db, {
      item,
      kind: "video",
      platform: "youtube",
      event: "approved",
      via: "person",
      meta,
    });
}

/**
 * The full-size Short (or the whole cut in a format) in the media bucket, for its Reel and the
 * other feeds: `wren video render` uploads it.
 */
export const reelKey = (short: number | CroppedFormat) => `reel-${short}`;

/** The whole cut's full renders in the media bucket, by format. */
export const framedStored = (e: Pick<VideoEdit, "keys">) =>
  Object.fromEntries(
    CROPPED.flatMap((f) => (e.keys[reelKey(f)] ? [[f, e.keys[reelKey(f)] as string]] : [])),
  ) as Partial<Record<CroppedFormat, string>>;

export interface SwappedDraft {
  id: string;
  platform: string;
  short: number;
  from: string;
  to: string;
}

/**
 * A Short rendered again reaching the drafts he already approved: each approved draft not out yet
 * points at the current render (YouTube at the file on the Mac, the rest at its Reel upload). The
 * slot, the words and his yes stay. Published, publishing, failed and waiting drafts are left
 * alone. One `video swap` run holds what each pointed at before.
 */
export async function swapShortMedia(
  db: Queryable,
  id: number,
  o: { short?: number; by: string },
): Promise<{ run: string; swapped: SwappedDraft[]; missing: string[] }> {
  return atomic(db, async (tx) => {
    const [e] = await tx.select().from(videoEdits).where(eq(videoEdits.id, id));
    if (!e) throw new Error(VIDEO_GONE);
    const numbers = o.short ? [o.short] : e.shorts.map((_, i) => i + 1);
    if (o.short && !e.shorts[o.short - 1])
      throw new Error(
        `${videoName(e)} has ${e.shorts.length} Shorts, so there's no Short ${o.short}.`,
      );
    const swapped: SwappedDraft[] = [];
    const missing: string[] = [];
    for (const n of numbers) {
      const rows = await tx
        .select({
          id: contentDrafts.id,
          platform: contentDrafts.platform,
          media: contentDrafts.media,
        })
        .from(contentDrafts)
        .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
        .where(
          and(
            eq(contentIdeas.ref, videoRef(id, n)),
            eq(contentDrafts.status, "approved"),
            sql`${contentDrafts.publishedAt} is null`,
          ),
        );
      for (const d of rows) {
        const next = d.platform === "youtube" ? e.files[`short-${n}`] : e.keys[reelKey(n)];
        if (!next) {
          missing.push(
            `short ${n} on ${d.platform}: no render (wren video render ${id} --short ${n})`,
          );
          continue;
        }
        const was = d.media?.source ?? "";
        if (!d.media || was === next) continue;
        // Guarded on approved: a post the scheduler took meanwhile keeps what it took.
        const done = await tx
          .update(contentDrafts)
          .set({ media: { ...d.media, source: next } })
          .where(and(eq(contentDrafts.id, d.id), eq(contentDrafts.status, "approved")))
          .returning({ id: contentDrafts.id });
        if (done.length)
          swapped.push({ id: d.id, platform: d.platform, short: n, from: was, to: next });
      }
    }
    const { id: run } = await openRun(tx, {
      command: "video swap",
      argv: { id, short: o.short ?? null, by: o.by },
    });
    await finishRun(tx, run, { swapped: swapped.length, before: swapped, missing });
    return { run, swapped, missing };
  });
}

const NO_TITLE = "This video has no title. Type one in its fields, then approve.";

/** What Approve uploads: the file, its title and (the long video only) its thumbnail. */
function target(e: VideoEdit, short?: number | "vertical") {
  if (short === "vertical") {
    const file = e.files.vertical;
    if (!file)
      throw new Error(`${videoName(e)} has no vertical cut yet. Press Render, then approve.`);
    if (!e.title.trim()) throw new Error(NO_TITLE);
    // Dropped by approveVideo when YouTube files it as a Short.
    const thumbnail = e.files.thumbnailPick ?? numbered(e.files, "thumb")[0] ?? null;
    return { file, title: e.title.trim().slice(0, 100), thumbnail };
  }
  if (!short) {
    const file = longOf(e.files);
    if (!file) throw new Error(`${videoName(e)} has no long cut yet. Press Render, then approve.`);
    if (!e.title.trim()) throw new Error(NO_TITLE);
    const thumbnail = e.files.thumbnailPick ?? numbered(e.files, "thumb")[0] ?? null;
    return { file, title: e.title.trim().slice(0, 100), thumbnail };
  }
  const file = e.files[`short-${short}`];
  const s = e.shorts[short - 1];
  if (!file || !s)
    throw new Error(
      `${videoName(e)} has no Short ${short} rendered yet. Press Render, then approve.`,
    );
  // Custom thumbnails don't apply to Shorts: YouTube picks a frame.
  return { file, title: (s.title || e.title).trim().slice(0, 100), thumbnail: null };
}

/** His pick of the rendered thumbnails (1-based); the long video's upload sets it. */
export async function pickThumbnail(db: Queryable, id: number, n: number): Promise<string> {
  return atomic(db, async (tx) => {
    const [e] = await tx.select().from(videoEdits).where(eq(videoEdits.id, id)).for("update");
    if (!e) throw new Error(VIDEO_GONE);
    const file = e.files[`thumb-${n}`];
    if (!file) throw new Error(`${videoName(e)} has no thumbnail ${n}. Press Render to draw them.`);
    await tx
      .update(videoEdits)
      .set({ files: { ...e.files, thumbnailPick: file }, updatedAt: new Date() })
      .where(eq(videoEdits.id, id));
    return file;
  });
}

const neutral = (label: string): State => ({ label, tone: "neutral" });
export const VIDEO_STATES: Record<string, State> = {
  added: neutral("Added"),
  edited: neutral("Editing"),
  rendered: { label: "Waiting on you", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  uploaded: { label: "On YouTube", tone: "good" },
  failed: { label: "Upload failed", tone: "bad" },
  rejected: { label: "Rejected", tone: "neutral" },
};

/** A render asked for from the page, on its way; none once done. */
export const RENDER_STATES: Record<string, State> = {
  waiting: neutral("Waiting for the Mac"),
  rendering: neutral("Rendering"),
  failed: { label: "Render failed", tone: "bad" },
};

/** Each cut with the words it strikes and the ones either side, for the page's Keep or Cut. */
export const cutRows = (e: Pick<VideoEdit, "cuts" | "words">) =>
  reviewCuts(e.cuts, e.words).map((r) => ({
    from: r.cut.from,
    to: r.cut.to,
    why: r.cut.why,
    state: r.cut.state,
    lengthS: r.lengthS,
    words: e.words
      .filter((w) => (w.s + w.e) / 2 >= r.cut.from && (w.s + w.e) / 2 < r.cut.to)
      .map((w) => w.w)
      .join(" "),
    before: r.before,
    after: r.after,
  }));

/** The outputs a render made that the edit has since changed (null: can't tell). */
function staleOf(e: VideoEdit): string[] | null {
  try {
    return changedSince(e);
  } catch {
    return null;
  }
}

/**
 * What the finishing view edits (designs/2026-10-15-video-finishing.md): the raw recording's
 * playback copies and filmstrip, the fields it saves as they are stored (its `expect`), the
 * caption lines as the render breaks them, and each cropped format's cover and render.
 */
async function finishOf(
  e: VideoEdit,
  sign: (key: string | null | undefined) => Promise<string | null>,
) {
  const { main, cam } = e.tracks;
  const covers = await Promise.all(
    CROPPED.map(async (f) => [f, await sign(e.keys[`cover-${f}`])] as const),
  );
  return {
    fps: 30,
    durationS: main.durationS,
    size: [main.width, main.height] as [number, number],
    camSize: cam ? ([cam.width, cam.height] as [number, number]) : null,
    source: await sign(e.keys.source),
    sourceCam: await sign(e.keys["source-cam"]),
    strip: await sign(e.keys.strip),
    picture: pictureOf(e.tracks),
    // What the long video shows when: the preview draws the corner camera as the render does.
    layout: e.layout,
    rendered: [...CROPPED, "long" as const].filter((f) => !!e.files[f]),
    shorts: e.shorts.map((s, i) => ({ n: i + 1, from: s.from, to: s.to, title: s.title })),
    // Is there a face to crop a Short on (a camera file, or a box in the recording)?
    face: !!(cam || e.tracks.camBox),
    covers: Object.fromEntries(covers.filter(([, url]) => url)),
    ...finishEdited(e),
  };
}

/** What a change to the edit moves in the finishing view: its caption lines and saved fields. */
const finishEdited = (e: VideoEdit): VideoView["finish"] => ({
  lines: captionLines(e.words, e.cuts, e.tracks.main.durationS),
  // Which formats' renders the edit has since changed; null when the renders predate hashes.
  stale: staleOf(e),
  saved: {
    cuts: e.cuts,
    overlays: e.overlays,
    crops: e.crops,
    captions: e.captions,
    thumbnail: e.thumbnail,
    formats: e.formats,
  },
});

/**
 * What a change to the edit moves on its page, with no links to sign: VideoDesk's saves answer
 * it, so the page patches itself in place instead of reading the video again.
 */
export interface VideoView {
  title: VideoEdit["title"];
  description: VideoEdit["description"];
  words: ReturnType<typeof markWords>;
  edit: Pick<
    VideoEdit,
    | "captions"
    | "stress"
    | "title"
    | "description"
    | "tags"
    | "chapters"
    | "shorts"
    | "formats"
    | "thumbnail"
  >;
  cuts: ReturnType<typeof cutRows>;
  finish: {
    lines: CaptionLine[];
    stale: string[] | null;
    saved: Pick<VideoEdit, "cuts" | "overlays" | "crops" | "captions" | "thumbnail" | "formats">;
  };
  render: VideoEdit["render"];
  state: VideoEdit["state"];
  steps: VideoStep[];
  checks: ReturnType<typeof videoChecks>;
  fresh: ReturnType<typeof previewCheck>;
}

export async function videoView(db: Queryable, e: VideoEdit): Promise<VideoView> {
  const steps = await videoSteps(db, e.id);
  const chaptersShown = chapterLines(e)
    .split("\n")
    .filter((l) => l.trim()).length;
  return {
    title: e.title,
    description: e.description,
    words: markWords(e.words, e.cuts, e.stress),
    edit: {
      captions: e.captions,
      stress: e.stress,
      title: e.title,
      description: e.description,
      tags: e.tags,
      chapters: e.chapters,
      shorts: e.shorts,
      formats: e.formats,
      thumbnail: e.thumbnail,
    },
    cuts: cutRows(e),
    finish: finishEdited(e),
    render: e.render,
    state: e.state,
    steps,
    checks: videoChecks(e, { chaptersShown, ...renderTimes(steps), stale: staleOf(e) }),
    // The line beside the preview: whether it shows the last change.
    fresh: previewCheck(e, { ...renderTimes(steps), stale: staleOf(e) }),
  };
}

/** The long video's draft, by its ref: uploading, on YouTube, or failed. */
const UPLOAD: Partial<Record<DraftStatus, string>> = {
  published: "uploaded",
  failed: "failed",
};

/** Where previews and stills are: a key in the media bucket, or an `s3://` object. */
export interface VideoSigner {
  bucket: string;
  /** A GET for an `s3://bucket/key` (the media host). */
  host: { host(source: string): Promise<string> };
}

export const videoRecord = (signer?: VideoSigner) => {
  const sign = (key: string | null | undefined) =>
    !key || !signer
      ? Promise.resolve(null)
      : signer.host.host(key.startsWith("s3://") ? key : `s3://${signer.bucket}/${key}`);
  return defineRecord({
    id: "marketing.video",
    app: "marketing",
    channel: "youtube",
    name: { one: "video", many: "videos" },
    rows: async (db) => {
      const rows = await db
        .select({
          id: videoEdits.id,
          title: videoEdits.title,
          state: videoEdits.state,
          tracks: videoEdits.tracks,
          cuts: videoEdits.cuts,
          shorts: videoEdits.shorts,
          files: videoEdits.files,
          render: videoEdits.render,
          updated: videoEdits.updatedAt,
          upload: contentDrafts.status,
          url: contentDrafts.url,
        })
        .from(videoEdits)
        .leftJoin(contentIdeas, eq(contentIdeas.ref, sql`'video:' || ${videoEdits.id}`))
        .leftJoin(contentDrafts, eq(contentDrafts.ideaId, contentIdeas.id))
        .orderBy(desc(videoEdits.updatedAt));
      return rows.map((r) => {
        const raw = r.tracks.main.durationS;
        return {
          id: r.id,
          title: r.title || `Video ${r.id}`,
          state: (r.upload && UPLOAD[r.upload]) ?? r.state,
          render: r.render?.state ?? null,
          raw: clock(raw),
          cut: clock(raw - cutSeconds(r.cuts)),
          shorts: r.shorts.length,
          // "yes" once rendered: what "Approve vertical" waits on.
          vertical: r.files.vertical ? "yes" : "no",
          url: r.url,
          updated: r.updated,
        };
      });
    },
    key: "id",
    title: "title",
    subtitle: "state",
    fields: {
      title: text("Title"),
      state: status(VIDEO_STATES),
      render: status(RENDER_STATES, "Render"),
      raw: text("Raw"),
      cut: text("Cut"),
      shorts: number("Shorts"),
      url: link("On YouTube"),
      updated: date("Changed"),
    },
    views: [
      {
        id: "waiting",
        label: "Waiting on you",
        where: { state: "rendered" },
        sort: "-updated",
        at: "updated",
      },
      {
        id: "uploaded",
        label: "On YouTube",
        where: { state: "uploaded" },
        sort: "-updated",
        at: "updated",
      },
      { id: "all", label: "All", sort: "-updated", at: "updated" },
      {
        id: "rejected",
        label: "Rejected",
        where: { state: "rejected" },
        sort: "-updated",
        at: "updated",
      },
    ],
    activity: { view: "draft_activity", by: "video", seq: "seq" },
    drafts: (id) => [`video:${id}`],
    thumbs: (db, ids) => videoThumbs(db, ids, signer),
    actions: [
      "marketing.videoRender",
      "marketing.videoApprove",
      "marketing.videoApproveShort",
      "marketing.videoApproveVertical",
      "marketing.videoThumbnail",
      "marketing.videoPromote",
      "marketing.videoSchedule",
      "marketing.videoReject",
      "marketing.videoRestore",
      // The page's own editor: fields, cuts, Ask Claude, Undo.
      "marketing.videoSet",
      "marketing.videoCut",
      "marketing.videoAsk",
      "marketing.videoUndo",
      "marketing.videoWords",
      "marketing.videoLine",
      "marketing.videoAgent",
    ],
    calls: {
      "ContentDesk/approveVideo": "id",
      "ContentDesk/pickThumbnail": "id",
      "ContentDesk/promote": "video",
      "VideoDesk/set": "id",
      "VideoDesk/cut": "id",
      "VideoDesk/ask": "id",
      "VideoDesk/undo": "id",
      "VideoDesk/words": "id",
      "VideoDesk/line": "id",
      "VideoDesk/render": "id",
      "VideoDesk/edit": "id",
      "VideoDesk/reject": "id",
      "VideoDesk/restore": "id",
    },
    /** The player, the transcript with its cuts, the Shorts, the stills, the words that go up. */
    load: async (db, id) => {
      const [e] = await db
        .select()
        .from(videoEdits)
        .where(eq(videoEdits.id, Number(id)))
        .limit(1);
      if (!e) return null;
      const shortKeys = numbered(e.keys, "short");
      const thumbFiles = numbered(e.files, "thumb");
      const thumbKeys = numbered(e.keys, "thumb");
      const picked = e.files.thumbnailPick ?? thumbFiles[0];
      const drafts = await db
        .select({ ref: contentIdeas.ref, status: contentDrafts.status, url: contentDrafts.url })
        .from(contentIdeas)
        .innerJoin(contentDrafts, eq(contentDrafts.ideaId, contentIdeas.id))
        .where(like(contentIdeas.ref, `video:${e.id}/%`));
      // Its promos (designs/2026-10-07-content-funnel.md): one draft per platform, pointing at it.
      const upload = await videoDraftOf(db, e.id).catch(() => null);
      // What the agent and he did, and what to look at before Approve (designs/2026-10-13-video-review.md).
      const view = await videoView(db, e);
      return {
        video: {
          ...view,
          preview: await sign(longOf(e.keys)),
          vertical: e.files.vertical
            ? {
                preview: await sign(e.keys.vertical),
                upload: drafts.find((d) => d.ref === videoRef(e.id, "vertical")) ?? null,
              }
            : null,
          finish: await finishOf(e, sign),
          promos: upload ? await promosOf(db, upload) : null,
          turns: await videoTurns(db, e.id),
          shorts: await Promise.all(
            e.shorts.map(async (s, i) => ({
              title: s.title,
              from: s.from,
              to: s.to,
              preview: await sign(shortKeys[i]),
              upload: drafts.find((d) => d.ref === videoRef(e.id, i + 1)) ?? null,
            })),
          ),
          thumbnails: await Promise.all(
            thumbKeys.map(async (k, i) => ({
              url: await sign(k),
              picked: !!picked && picked === thumbFiles[i],
            })),
          ),
        },
      };
    },
  });
};

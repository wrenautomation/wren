/**
 * Marketing → Videos (designs/2026-10-06-video-editor.md, Where it shows, Upload): each
 * `video_edits` row as a record, and Approve. Approve is William's yes: it writes a YouTube draft
 * whose media is the rendered file on the Mac, approved to go at once, private. The desk (the Mac)
 * reads the file from its own disk, so nothing uploads without his click.
 */
import { settingsFor, setWrenSettings } from "@wren/core/clients";
import { fieldsOf, YOUTUBE_PRIVACY } from "@wren/core/content/shapes";
import { recordDraft } from "@wren/core/draft-record";
import { date, defineRecord, link, number, type State, status, text } from "@wren/core/records";
import { atomic, type Queryable } from "@wren/db";
import { keepSegments, onCut, reviewCuts } from "@wren/studio/cuts";
import { type Cut, type VideoEdit, videoEdits, type Word } from "@wren/studio/schema";
import { desc, eq, like, sql } from "drizzle-orm";
import { contentDrafts, contentIdeas, type DraftStatus, type IdeaSource } from "./schema.js";
import { videoTurns } from "./video-ask.js";

/** The idea's ref: one draft per video, per Short and per vertical cut, ever. */
export const videoRef = (id: number, short?: number | "vertical") =>
  short === "vertical"
    ? `video:${id}/vertical`
    : short
      ? `video:${id}/short:${short}`
      : `video:${id}`;

/** `wren_settings.youtube`: the footer under every video's description. */
export const YOUTUBE_SETTINGS = "youtube";
const YT_DESCRIPTION = 5000;
/** Until he sets one: who he is and what the channel does. "" turns it off. */
export const DEFAULT_YOUTUBE_FOOTER = [
  "Wren Automation: https://wrenautomation.com",
  "I'm Will, a software engineering student at Waterloo, and I'm building Wren in public. Each video takes one high-ROI business problem, like ads or cold outreach, and works out how I'd solve it with software and AI. Subscribe to follow along.",
].join("\n\n");

export async function youtubeFooter(db: Queryable): Promise<string> {
  const block = (await settingsFor(db, null))[YOUTUBE_SETTINGS] as { footer?: unknown } | undefined;
  return typeof block?.footer === "string" ? block.footer : DEFAULT_YOUTUBE_FOOTER;
}

export async function setYoutubeFooter(db: Queryable, footer: string, by: string): Promise<string> {
  const text = footer.trim();
  if (text.length > 2000) throw new Error(`footer is ${text.length} characters: 2000 at most`);
  return atomic(db, async (tx) => {
    const block = ((await settingsFor(tx, null))[YOUTUBE_SETTINGS] ?? {}) as Record<
      string,
      unknown
    >;
    await setWrenSettings(tx, YOUTUBE_SETTINGS, { ...block, footer: text }, by);
    return text;
  });
}

/** Description, chapters, then the footer, blank lines between; the footer is never cut off. */
export function youtubeDescription(parts: string[], footer: string): string {
  const tail = footer.trim();
  const room = YT_DESCRIPTION - (tail ? tail.length + 2 : 0);
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

/** Each word with the cut over its middle: applied, proposed (yellow), or none. */
export function markWords(words: readonly Word[], cuts: readonly Cut[]) {
  const live = cuts.filter((c) => c.state !== "kept");
  return words.map((w) => {
    const mid = (w.s + w.e) / 2;
    const c = live.find((x) => mid >= x.from && mid < x.to);
    return { w: w.w, s: w.s, e: w.e, cut: c ? c.state : null };
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
}

/** IG captions stop at 2,200 characters. */
const IG_CAPTION = 2200;
/** YouTube files a vertical this long or shorter as a Short: no custom thumbnail. */
const SHORT_MAX_S = 180;

/**
 * His yes on the long video, Short `short` (1-based) or the vertical cut: a YouTube draft, approved
 * to go on the next pass, private. A Short or the vertical also gets an Instagram Reel draft of the same render, from the
 * media bucket (Graph fetches a URL), waiting in To approve: it posts only on his Approve there.
 * Approving the same one again answers its drafts and adds only a missing Reel draft.
 */
export async function approveVideo(
  db: Queryable,
  id: number,
  o: ApproveVideo,
): Promise<ApprovedVideo> {
  return atomic(db, async (tx) => {
    const [e] = await tx.select().from(videoEdits).where(eq(videoEdits.id, id)).for("update");
    if (!e) throw new Error(`no video ${id}`);
    // A vertical-only recording: his yes (the Inbox's too) is on the vertical cut.
    const vertical = !o.short && (o.vertical || !e.formats.includes("long"));
    const reels = vertical ? ("vertical" as const) : o.short;
    const ref = videoRef(id, reels);
    const had = await tx
      .select({ id: contentDrafts.id, platform: contentDrafts.platform, ideaId: contentIdeas.id })
      .from(contentDrafts)
      .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
      .where(eq(contentIdeas.ref, ref));
    const yt = had.find((d) => d.platform === "youtube");
    const now = o.now ?? new Date();
    if (yt && !reels) return { id: yt.id, again: true };
    if (!yt && !["rendered", "approved", "uploaded"].includes(e.state))
      throw new Error(`video ${id} is ${e.state}: render it first (wren video render ${id})`);
    const { file, title, thumbnail } = target(e, reels);
    // YouTube files a vertical of 3 min or less as a Short.
    const kind =
      o.short || (vertical && e.tracks.main.durationS - cutSeconds(e.cuts) <= SHORT_MAX_S)
        ? "short"
        : "video";
    // Chapters go under the description (a Short has none), then the standing footer.
    const body = youtubeDescription(
      [e.description, kind === "short" ? "" : chapterLines(e)],
      await youtubeFooter(tx),
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
            privacyStatus: o.privacy ?? "private",
            madeForKids: false,
            ...(e.tags.length ? { tags: e.tags } : {}),
            ...(thumbnail && kind === "video" ? { thumbnail } : {}),
          }),
          status: "approved",
          approvedAt: now,
          // Null: the next publish pass.
          scheduledFor: null,
          promptVersion: "video",
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
    if (reel) return { ...out, reel: { id: reel.id, again: true } };
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
    const caption = [title, e.description].filter(Boolean).join("\n\n").slice(0, IG_CAPTION);
    const [r] = await tx
      .insert(contentDrafts)
      .values({
        ideaId,
        platform: "instagram",
        text: caption,
        title,
        media: { kind: "video", source: stored, title },
        extra: fieldsOf("instagram", { shareToFeed: true }),
        // Waits in To approve; his Approve gives it the next Instagram slot.
        status: "draft",
        promptVersion: "video",
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
    return { ...out, reel: { id: r.id, again: false } };
  });
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
    platform: o.wait ? "instagram" : "youtube",
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

/** The full-size Short (or vertical) in the media bucket, for its Reel: `wren video render` uploads it. */
export const reelKey = (short: number | "vertical") => `reel-${short}`;

/** What Approve uploads: the file, its title and (the long video only) its thumbnail. */
function target(e: VideoEdit, short?: number | "vertical") {
  if (short === "vertical") {
    const file = e.files.vertical;
    if (!file)
      throw new Error(`video ${e.id} has no rendered vertical (wren video render ${e.id})`);
    if (!e.title.trim()) throw new Error(`video ${e.id} has no title (wren video set)`);
    // Dropped by approveVideo when YouTube files it as a Short.
    const thumbnail = e.files.thumbnailPick ?? numbered(e.files, "thumb")[0] ?? null;
    return { file, title: e.title.trim().slice(0, 100), thumbnail };
  }
  if (!short) {
    const file = longOf(e.files);
    if (!file) throw new Error(`video ${e.id} has no rendered long file`);
    if (!e.title.trim()) throw new Error(`video ${e.id} has no title (wren video set)`);
    const thumbnail = e.files.thumbnailPick ?? numbered(e.files, "thumb")[0] ?? null;
    return { file, title: e.title.trim().slice(0, 100), thumbnail };
  }
  const file = e.files[`short-${short}`];
  const s = e.shorts[short - 1];
  if (!file || !s) throw new Error(`video ${e.id} has no rendered Short ${short}`);
  // Custom thumbnails don't apply to Shorts: YouTube picks a frame.
  return { file, title: (s.title || e.title).trim().slice(0, 100), thumbnail: null };
}

/** His pick of the rendered thumbnails (1-based); the long video's upload sets it. */
export async function pickThumbnail(db: Queryable, id: number, n: number): Promise<string> {
  return atomic(db, async (tx) => {
    const [e] = await tx.select().from(videoEdits).where(eq(videoEdits.id, id)).for("update");
    if (!e) throw new Error(`no video ${id}`);
    const file = e.files[`thumb-${n}`];
    if (!file) throw new Error(`video ${id} has no rendered thumbnail ${n}`);
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
      { id: "all", label: "All", sort: "-updated", at: "updated" },
    ],
    activity: { view: "draft_activity", by: "video", seq: "seq" },
    drafts: (id) => [`video:${id}`],
    actions: [
      "marketing.videoRender",
      "marketing.videoApprove",
      "marketing.videoApproveShort",
      "marketing.videoApproveVertical",
      "marketing.videoThumbnail",
      // The page's own editor: fields, cuts, Ask Claude, Undo.
      "marketing.videoSet",
      "marketing.videoCut",
      "marketing.videoAsk",
      "marketing.videoUndo",
      "marketing.videoWords",
    ],
    calls: {
      "ContentDesk/approveVideo": "id",
      "ContentDesk/pickThumbnail": "id",
      "VideoDesk/set": "id",
      "VideoDesk/cut": "id",
      "VideoDesk/ask": "id",
      "VideoDesk/undo": "id",
      "VideoDesk/words": "id",
      "VideoDesk/render": "id",
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
      return {
        video: {
          title: e.title,
          description: e.description,
          preview: await sign(longOf(e.keys)),
          words: markWords(e.words, e.cuts),
          edit: {
            title: e.title,
            description: e.description,
            tags: e.tags,
            chapters: e.chapters,
            shorts: e.shorts,
            formats: e.formats,
            thumbnail: e.thumbnail,
          },
          vertical: e.files.vertical
            ? {
                preview: await sign(e.keys.vertical),
                upload: drafts.find((d) => d.ref === videoRef(e.id, "vertical")) ?? null,
              }
            : null,
          cuts: cutRows(e),
          render: e.render,
          state: e.state,
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

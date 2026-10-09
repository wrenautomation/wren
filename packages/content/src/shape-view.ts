/**
 * A draft as the field editor and the platform preview draw it (designs/2026-10-07-post-shapes.md):
 * its fields with their UI, its words, and a short-lived link for each stored file (thumbnail,
 * cover, the video). Published, it is what went out, with what the platform refused after.
 */
import type { Platform } from "@wren/core/content";
import { type FieldView, fieldViews, kindOf } from "@wren/core/content/shapes";
import {
  carouselUnfit,
  cleanSlides,
  isCarousel,
  type Slide,
  slidesKey,
} from "@wren/core/content/slides";
import {
  isThread,
  THREAD_MAX,
  THREAD_MIN,
  threadPosts,
  withLink,
  X_POST_MAX,
  xLength,
} from "@wren/core/content/thread";
import { partFlags } from "@wren/core/grounded";
import type { Queryable } from "@wren/db";
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { type FunnelVideo, type FunnelView, readFunnel } from "./funnel.js";
import { PLATFORM_SPECS } from "./platforms.js";
import { RECORDED } from "./promo.js";
import { contentDrafts, contentIdeas, type DraftStatus } from "./schema.js";
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
  /** Its stage, target and link (designs/2026-10-07-content-funnel.md), and the videos it may point at. */
  funnel: FunnelView & { videos: FunnelVideo[] };
  /** An X thread: its limits, and each saved post's count and facts-guard flags. */
  thread: ThreadView | null;
  /** A carousel: its slides, the drawn files, and the drafts that share the set. */
  carousel: CarouselView | null;
}

export interface ThreadView {
  min: number;
  max: number;
  /** X's cap on each post. */
  each: number;
  /** As saved: the link on the last; the flags name what the guard would ask about. */
  posts: { text: string; count: number; flags: string[] }[];
}

export interface CarouselView {
  slides: Slide[];
  /** Signed links to each square image and the PDF, once drawn. */
  images: string[];
  pdf: string | null;
  /** The drawn files show the slides as saved now. */
  fresh: boolean;
  drawn: string | null;
  /** The drafts drawn from the same set, this one first. */
  shares: { id: string; platform: Platform; kind: string; status: DraftStatus }[];
  /** Why it can't post yet (not drawn, or drawn before an edit), or null when it can. */
  unfit: string | null;
}

/** YouTube videos a post may point at: the newest not turned down, Shorts left out. */
export function pickableVideos(db: Queryable, except?: string): Promise<FunnelVideo[]> {
  return db
    .select({
      id: contentDrafts.id,
      title: contentDrafts.title,
      url: contentDrafts.url,
      status: contentDrafts.status,
    })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.platform, "youtube"),
        sql`coalesce(${contentDrafts.extra}->>'kind', 'video') = 'video'`,
        notInArray(contentDrafts.status, ["rejected", "failed"]),
        ...(except ? [ne(contentDrafts.id, except)] : []),
      ),
    )
    .orderBy(desc(contentDrafts.createdAt))
    .limit(30);
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
  const funnel = await readFunnel(db, d);
  const videos = await pickableVideos(db, d.id);
  // The one it points at stays pickable even past the newest 30.
  if (funnel.video && !videos.some((v) => v.id === funnel.video?.id)) videos.push(funnel.video);
  return {
    thread: isThread(d) ? await threadView(db, d, funnel.posts) : null,
    carousel: isCarousel(d) ? await carouselView(db, d, signer) : null,
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
    funnel: { ...funnel, videos },
  };
}

/** A thread's posts as saved, each counted as X counts it and checked like the drafts are. */
async function threadView(
  db: Queryable,
  d: typeof contentDrafts.$inferSelect,
  link: string | null,
): Promise<ThreadView> {
  const [idea] = await db
    .select({ text: contentIdeas.text })
    .from(contentIdeas)
    .where(eq(contentIdeas.id, d.ideaId))
    .limit(1);
  const posts = threadPosts(d.text);
  const out = withLink(posts, link);
  const g = { facts: [], sources: [], own: [idea?.text ?? "", RECORDED] };
  return {
    min: THREAD_MIN,
    max: THREAD_MAX,
    each: X_POST_MAX,
    posts: posts.map((text, i) => ({
      text,
      count: xLength(out[i] ?? text),
      flags: partFlags([{ label: `post ${i + 1}`, text }], g).map((f) =>
        f.text.replace(/^post \d+: /, ""),
      ),
    })),
  };
}

/** A carousel's set, its drawn files signed, and the drafts that share it. */
async function carouselView(
  db: Queryable,
  d: typeof contentDrafts.$inferSelect,
  signer: VideoSigner | undefined,
): Promise<CarouselView> {
  const slides = cleanSlides(d.extra?.slides);
  const drawn = d.extra?.rendered as
    | { images?: string[]; pdf?: string | null; of?: string; at?: string }
    | undefined;
  const images: string[] = [];
  for (const k of drawn?.images ?? []) {
    const url = await linkOf(k, signer);
    if (url) images.push(url);
  }
  const deck = typeof d.extra?.deck === "string" ? d.extra.deck : null;
  const shares = deck
    ? await db
        .select({
          id: contentDrafts.id,
          platform: contentDrafts.platform,
          extra: contentDrafts.extra,
          status: contentDrafts.status,
        })
        .from(contentDrafts)
        .where(sql`${contentDrafts.extra}->>'deck' = ${deck}`)
        .orderBy(contentDrafts.createdAt)
    : [];
  return {
    slides,
    images,
    pdf: await linkOf(drawn?.pdf, signer),
    fresh: Boolean(
      drawn?.of && drawn.of === slidesKey(slides) && drawn.images?.length === slides.length,
    ),
    drawn: drawn?.at ?? null,
    shares: [
      { id: d.id, platform: d.platform, kind: kindOf(d.extra), status: d.status },
      ...shares
        .filter((r) => r.id !== d.id)
        .map((r) => ({ id: r.id, platform: r.platform, kind: kindOf(r.extra), status: r.status })),
    ],
    unfit: carouselUnfit(d),
  };
}

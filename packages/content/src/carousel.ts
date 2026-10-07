/**
 * Carousels (designs/2026-10-07-content-funnel.md, build order 3): one slide set from a video
 * (`draftCarousel` in ./promo.ts), drafted as two posts that share it: a LinkedIn document post
 * (its words plus the slides as a PDF) and an Instagram carousel (a caption plus a square image
 * per slide). The set is the drafts' `slides` field, written to both at once (`saveSlides`);
 * `renderSlides` draws it with
 * `@wren/core/content/slides` and stores the images and the PDF. Nothing uploads: approve says the
 * upload is in development, and he can download the files to post by hand.
 */
import { fieldsOf } from "@wren/core/content/shapes";
import {
  cleanSlides,
  isCarousel,
  type Slide,
  slidesHtml,
  slidesKey,
  slidesUnfit,
} from "@wren/core/content/slides";
import { type DraftVia, recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type MediaStoreOptions, putMedia } from "./media.js";
import { type ContentDraft, contentDrafts, type DraftStatus } from "./schema.js";

/** A slide set drawn: one PNG per slide, square, and the same slides as one PDF. */
export interface SlidePaint {
  images: Uint8Array[];
  pdf: Uint8Array;
}
/** Draws `slidesHtml`'s page: `count` square slides. A browser in production, a fake in tests. */
export type SlidePainter = (html: string, count: number) => Promise<SlidePaint>;

/** What a render left on the drafts: stored keys and the set they show. */
export interface SlideFiles {
  images: string[];
  pdf: string | null;
  of: string;
  at: string;
}

const EDITABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];

/** The drafts that share `d`'s slide set (it among them), oldest first. */
export async function deckOf(db: Queryable, d: ContentDraft): Promise<ContentDraft[]> {
  const deck = typeof d.extra?.deck === "string" ? d.extra.deck : null;
  if (!deck) return [d];
  return db
    .select()
    .from(contentDrafts)
    .where(sql`${contentDrafts.extra}->>'deck' = ${deck}`)
    .orderBy(contentDrafts.createdAt);
}

async function carouselOf(db: Queryable, id: string): Promise<ContentDraft> {
  const [d] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).limit(1);
  if (!d) throw new Error(`no draft ${id}`);
  if (!isCarousel(d)) throw new Error(`${id} isn't a carousel`);
  if (!EDITABLE.includes(d.status)) throw new Error(`cannot change ${id}: it is ${d.status}`);
  return d;
}

/**
 * Save a slide set on every draft that shares it, checked first: 5 to 10 slides, a title each, a
 * few short lines. The drawn files no longer match, so they're dropped; draw again to post.
 * Slides are words: an approved draft goes back to `draft`, like an edit of its text.
 */
export async function saveSlides(
  db: Queryable,
  id: string,
  slides: unknown,
  who?: { by: string; via?: DraftVia },
): Promise<ContentDraft[]> {
  const d = await carouselOf(db, id);
  const next = cleanSlides(slides);
  const bad = slidesUnfit(next);
  if (bad) throw new Error(bad);
  const before = cleanSlides(d.extra?.slides);
  if (slidesKey(before) === slidesKey(next)) return [d];
  const out: ContentDraft[] = [];
  for (const r of await deckOf(db, d)) {
    if (!EDITABLE.includes(r.status)) continue;
    const { rendered: _drawn, ...rest } = r.extra ?? {};
    const [row] = await db
      .update(contentDrafts)
      .set({
        extra: fieldsOf(r.platform, { ...rest, slides: next }),
        edited: true,
        status: "draft",
        error: null,
      })
      .where(and(eq(contentDrafts.id, r.id), inArray(contentDrafts.status, [...EDITABLE])))
      .returning();
    if (!row) continue;
    out.push(row);
    if (who)
      await recordDraft(db, {
        item: `draft:${row.id}`,
        platform: row.platform,
        event: "edited",
        via: who.via ?? "person",
        by: who.by,
        text: row.text,
        title: row.title,
        meta: { slides: [before, next] },
      });
  }
  return out;
}

/** The slide set of a carousel draft, checked, and the page that draws it. */
export async function slidesToDraw(
  db: Queryable,
  id: string,
  by?: string,
): Promise<{ slides: Slide[]; html: string }> {
  const d = await carouselOf(db, id);
  const slides = cleanSlides(d.extra?.slides);
  const bad = slidesUnfit(slides);
  if (bad) throw new Error(bad);
  return { slides, html: slidesHtml(slides, by ? { by } : {}) };
}

/** Draw the set and store each file under its content hash: the same slides, the same keys. */
export async function paintSlides(
  slides: readonly Slide[],
  html: string,
  paint: SlidePainter,
  store: MediaStoreOptions,
): Promise<SlideFiles> {
  const drawn = await paint(html, slides.length);
  if (drawn.images.length !== slides.length)
    throw new Error(`drew ${drawn.images.length} of ${slides.length} slides`);
  const images: string[] = [];
  for (const img of drawn.images) images.push(await putMedia(img, ".png", store));
  return {
    images,
    pdf: await putMedia(drawn.pdf, ".pdf", store),
    of: slidesKey(slides),
    at: new Date().toISOString(),
  };
}

/**
 * Keep a render on every draft that shares the set, unless the set changed while it drew (then
 * it's stale: nothing is written and the caller says so).
 */
export async function keepSlideFiles(
  db: Queryable,
  id: string,
  files: SlideFiles,
): Promise<ContentDraft[]> {
  const d = await carouselOf(db, id);
  if (slidesKey(cleanSlides(d.extra?.slides)) !== files.of)
    throw new Error("the slides changed while they drew: draw them again");
  const out: ContentDraft[] = [];
  for (const r of await deckOf(db, d)) {
    if (!EDITABLE.includes(r.status)) continue;
    const [row] = await db
      .update(contentDrafts)
      .set({ extra: fieldsOf(r.platform, { ...r.extra, rendered: files }) })
      .where(eq(contentDrafts.id, r.id))
      .returning();
    if (row) out.push(row);
  }
  return out;
}

/** Draw and keep, in one: the CLI's and the tests' path. The desk journals the two apart. */
export async function renderSlides(
  db: Queryable,
  id: string,
  paint: SlidePainter,
  store: MediaStoreOptions,
  o: { by?: string } = {},
): Promise<SlideFiles> {
  const { slides, html } = await slidesToDraw(db, id, o.by);
  const files = await paintSlides(slides, html, paint, store);
  await keepSlideFiles(db, id, files);
  return files;
}

/**
 * Promo posts (designs/2026-10-07-content-funnel.md): one YouTube video → one draft per platform,
 * each in its platform's tone, pointing at the video. The video's own title and description are
 * the idea, so the facts guard holds every claim to his words. Nothing posts: each draft waits in
 * To approve, and its link fills in from the video once it is on YouTube.
 *
 * Reddit stays organic: the lesson as its own post, first person, no pitch, in the best-fit
 * watched subreddit that takes posts; it mentions the video only where that sub allows links.
 * Instagram can't post words alone, so its promo rides on the video's vertical cut or first Short.
 *
 * Past the one post per platform, a promo takes two more pieces: an X thread (3 to 7 posts in one
 * draft, `@wren/core/content/thread`) and a carousel (one slide set as a LinkedIn PDF and an
 * Instagram carousel, `./carousel.ts`).
 */
import { randomUUID } from "node:crypto";
import type { Platform } from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";
import {
  cleanSlides,
  isCarousel,
  SLIDE_LINE_MAX,
  SLIDE_TITLE_MAX,
  SLIDES_MAX,
  SLIDES_MIN,
  slidesUnfit,
} from "@wren/core/content/slides";
import {
  isThread,
  THREAD_MAX,
  THREAD_MIN,
  threadText,
  threadUnfit,
} from "@wren/core/content/thread";
import { droppedWhy, guardParts, recordGuard } from "@wren/core/grounded";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { videoEdits } from "@wren/studio/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  askGuarded,
  DRAFT_STAGE,
  type DraftOptions,
  type DraftResult,
  draftPrompt,
  keepGenerated,
  unfitProposal,
} from "./draft.js";
import { lessonsFor } from "./lessons.js";
import { PLATFORM_SPECS } from "./platforms.js";
import { playbookFor } from "./playbook.js";
import { type ContentDraft, type ContentIdea, contentDrafts, contentIdeas } from "./schema.js";
import { DEFAULT_BRAND, DEFAULT_VOICE } from "./voice.js";

/** Bump when a promo brief changes. */
export const PROMO_PROMPT_VERSION = "promo-v1";
/** Where a video gets promoted, in order. */
export const PROMO_PLATFORMS = [
  "linkedin",
  "x",
  "reddit",
  "instagram",
] as const satisfies readonly Platform[];
export type PromoPlatform = (typeof PROMO_PLATFORMS)[number];
/** What a promo can draft: one post per platform, an X thread, a carousel. */
export const PROMO_PIECES = ["posts", "thread", "carousel"] as const;
export type PromoPiece = (typeof PROMO_PIECES)[number];
/** A promo draft's piece: a single post, a thread or a carousel. */
export type PromoKind = "post" | "thread" | "carousel";
export const promoKindOf = (d: {
  platform: string;
  extra?: Readonly<Record<string, unknown>> | null;
}): PromoKind => (isThread(d) ? "thread" : isCarousel(d) ? "carousel" : "post");

/** A video that can be promoted: approved to upload, uploading or up. */
const PROMOTABLE = ["approved", "publishing", "published"] as const;

/** True of every promo, and the Reddit brief may say it: backs "I recorded a walkthrough". */
export const RECORDED = "I recorded a walkthrough video of this.";

/** The idea's ref: one promo idea per video. */
export const promoRef = (videoDraft: string) => `promo:${videoDraft}`;

/** A watched subreddit for the Reddit promo, as research judged it. */
export interface PromoPlace {
  subreddit: string;
  name: string;
  rules: string;
  links: boolean;
}

/** Where the promo idea stands: its idea, the video, and what each platform can carry. */
export interface PromoBase {
  idea: ContentIdea;
  video: Pick<ContentDraft, "id" | "title" | "status" | "url">;
  /** The video_edits row behind it, when the editor made it. */
  edit: number | null;
  place: PromoPlace | null;
  /** A Reel file for Instagram (the vertical cut, else the first Short), or null. */
  reel: string | null;
}

/** The text before the footer: the first line with a `/go/` link ends it. */
export function withoutFooter(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /\/go\//.test(l));
  return (at >= 0 ? lines.slice(0, at) : lines).join("\n").trim();
}

/** What each platform's promo is told to write. `link` says whether the post carries the video's. */
export function promoShape(platform: PromoPlatform, o: { place?: PromoPlace | null }): string {
  const linkLine =
    "The link to the video is added on its own line after the post; never write a link or a URL.";
  switch (platform) {
    case "linkedin":
      return `a LinkedIn post that sends people to watch a new YouTube video: a one-line hook that states the problem or the result, then short lines (one idea each, blank lines between) on what the viewer will learn, the last line says the full walkthrough is in the video. No hashtags, no emoji, under 1100 characters. ${linkLine}`;
    case "x":
      return `one post on X that sends people to a new YouTube video: dense and opinionated, written for people who already know the field, one sharp claim from the video and why it matters, no hashtags, no emoji, under 230 characters. ${linkLine}`;
    case "reddit": {
      const place = o.place;
      const rules = place?.rules ? ` The subreddit's rules, as read: ${place.rules}` : "";
      const link = place?.links
        ? " At the very end you may add one plain line saying you recorded a walkthrough, without a link; the link is added after it."
        : " Do not mention the video, a channel, a link or any way to find more; the post must stand on its own.";
      return `a Reddit text post for r/${place?.name ?? "the subreddit"}: the lesson from the video told as its own post, first person, like a practitioner sharing what they did and what they learned, specifics from the idea, no pitch, no selling, no emoji, no hashtags. A plain title that states the point (under 120 characters), then the body under 2000 characters.${link}${rules}`;
    }
    case "instagram":
      return "an Instagram Reel caption for a clip from a longer YouTube video: a first line that stands alone, two or three short lines on what the full video shows, then a line saying the full video is on YouTube, link in bio. Then up to five relevant hashtags on the last line. Never write a URL.";
  }
}

/** The best-fit watched subreddit that takes posts (outreach's table, read by SQL). */
async function promoPlace(db: Queryable): Promise<PromoPlace | null> {
  const rows = await db.execute<{
    subreddit: string;
    name: string;
    rules: string | null;
    links: boolean;
  }>(
    sql`select subreddit, name, judged->>'rules' rules,
          coalesce(not (judged->>'linkOnly')::boolean, false) links
        from reddit_places
        where state = 'watching' and coalesce((judged->>'mayPost')::boolean, false)
        order by fit desc nulls last, subscribers desc nulls last
        limit 1`,
  );
  const r = rows[0];
  return r ? { subreddit: r.subreddit, name: r.name, rules: r.rules ?? "", links: r.links } : null;
}

/** A YouTube video draft id from the video editor's id: its long upload, else its vertical cut. */
export async function videoDraftOf(db: Queryable, video: number): Promise<string> {
  const rows = await db
    .select({ id: contentDrafts.id, ref: contentIdeas.ref, extra: contentDrafts.extra })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(
      and(
        inArray(contentIdeas.ref, [`video:${video}`, `video:${video}/vertical`]),
        eq(contentDrafts.platform, "youtube"),
      ),
    );
  const long =
    rows.find((r) => r.ref === `video:${video}`) ??
    rows.find((r) => (r.extra?.kind ?? "video") === "video");
  if (!long) throw new Error(`video ${video} isn't approved for YouTube yet: approve it first`);
  return long.id;
}

/**
 * The YouTube video draft a promo starts from, or a throw saying why not: not YouTube, a Short, or
 * not approved to go up. Read only, so the portal can ask before it starts one.
 */
export async function promotable(db: Queryable, videoDraft: string) {
  const [v] = await db
    .select({
      id: contentDrafts.id,
      title: contentDrafts.title,
      text: contentDrafts.text,
      status: contentDrafts.status,
      url: contentDrafts.url,
      platform: contentDrafts.platform,
      extra: contentDrafts.extra,
      ref: contentIdeas.ref,
    })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(eq(contentDrafts.id, videoDraft))
    .limit(1);
  if (v?.platform !== "youtube") throw new Error(`${videoDraft} isn't a YouTube draft`);
  if (v.extra?.kind === "short")
    throw new Error("a Short can't be promoted: promote its long video");
  if (!(PROMOTABLE as readonly string[]).includes(v.status))
    throw new Error(`the video is ${v.status}: approve it for YouTube first`);
  return v;
}

/**
 * The promo's idea for a YouTube video draft, made once (ref `promo:<draft>`): the video's title
 * and description without its footer. Refuses what `promotable` refuses.
 */
export async function promoBase(db: Queryable, videoDraft: string): Promise<PromoBase> {
  const v = await promotable(db, videoDraft);
  const editId = /^video:(\d+)/.exec(v.ref ?? "")?.[1];
  const [e] = editId
    ? await db
        .select({
          title: videoEdits.title,
          description: videoEdits.description,
          keys: videoEdits.keys,
        })
        .from(videoEdits)
        .where(eq(videoEdits.id, Number(editId)))
        .limit(1)
    : [];
  const title = e?.title || v.title || "";
  const about = e?.description || withoutFooter(v.text);
  if (!`${title}${about}`.trim())
    throw new Error("the video has no title or description to promote");
  const ref = promoRef(v.id);
  const [had] = await db.select().from(contentIdeas).where(eq(contentIdeas.ref, ref)).limit(1);
  const idea =
    had ??
    (
      await db
        .insert(contentIdeas)
        .values({
          text: `${title}\n\n${about}`.trim(),
          source: "promo",
          ref,
          status: "drafted",
        })
        .onConflictDoNothing({ target: contentIdeas.ref })
        .returning()
    )[0] ??
    (await db.select().from(contentIdeas).where(eq(contentIdeas.ref, ref)).limit(1))[0];
  if (!idea) throw new Error("no promo idea");
  return {
    idea,
    video: { id: v.id, title: v.title, status: v.status, url: v.url },
    edit: editId ? Number(editId) : null,
    place: await promoPlace(db),
    reel: e?.keys["reel-vertical"] ?? e?.keys["reel-1"] ?? null,
  };
}

/** Drafts already made for this promo, by platform and piece ("x/thread"), not turned down. */
export async function liveOf(db: Queryable, ideaId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: contentDrafts.id, platform: contentDrafts.platform, extra: contentDrafts.extra })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.ideaId, ideaId),
        inArray(contentDrafts.status, ["draft", "approved", "publishing", "published"]),
      ),
    );
  return new Map(rows.map((r) => [`${r.platform}/${promoKindOf(r)}`, r.id]));
}

/** Why the platform's promo can't be drafted, or null. */
export async function promoSkip(
  db: Queryable,
  base: PromoBase,
  platform: PromoPlatform,
  again = false,
): Promise<string | null> {
  if (!again && (await liveOf(db, base.idea.id)).has(`${platform}/post`)) return "already drafted";
  if (platform === "reddit" && !base.place)
    return "no watched subreddit takes posts: watch one in Marketing → Places";
  if (platform === "instagram") {
    if (!base.reel) return "a Reel needs a vertical cut or a Short: render one first";
    // The video's own Reel draft carries the same file: don't post it twice.
    const [same] = await db
      .select({ id: contentDrafts.id })
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.platform, "instagram"),
          sql`${contentDrafts.media}->>'source' = ${base.reel}`,
          inArray(contentDrafts.status, ["draft", "approved", "publishing", "published"]),
        ),
      )
      .limit(1);
    if (same) return "this video's Reel is already drafted or posted";
  }
  return null;
}

/** One platform's promo draft: the platform's brief, guarded like any draft, waiting in To approve. */
export async function draftPromo(
  db: Queryable,
  llm: LlmClient,
  base: PromoBase,
  platform: PromoPlatform,
  o: DraftOptions = {},
): Promise<DraftResult> {
  const skip = await promoSkip(db, base, platform, o.again);
  if (skip) return { platform, ok: false, reason: skip };
  const spec = PLATFORM_SPECS[platform];
  const playbook = await playbookFor(db, platform);
  const media =
    platform === "instagram" && base.reel
      ? { kind: "video" as const, source: base.reel, title: base.video.title ?? "" }
      : null;
  const prompt = draftPrompt(
    { text: base.idea.text, media },
    { ...spec, shape: promoShape(platform, { place: base.place }) },
    {
      voice: o.voice ?? DEFAULT_VOICE,
      brand: o.brand ?? DEFAULT_BRAND,
      lessons: await lessonsFor(db, platform),
      playbook,
      ...(o.facts ? { facts: o.facts } : {}),
    },
  );
  const { outcome, why } = await askGuarded(db, llm, prompt, [base.idea.text, RECORDED], {
    ...o,
    item: `idea:${base.idea.id}/${platform}`,
    metadata: {
      platform,
      ideaId: base.idea.id,
      video: base.video.id,
      version: PROMO_PROMPT_VERSION,
    },
  });
  if (why) return { platform, ok: false, reason: why };
  if (!outcome.parsed)
    return {
      platform,
      ok: false,
      reason: outcome.providerRejected ?? outcome.parseError ?? "no answer",
    };
  const bad = unfitProposal(spec, outcome.parsed);
  if (bad) return { platform, ok: false, reason: bad };
  const extra =
    platform === "reddit" && base.place
      ? fieldsOf("reddit", { subreddit: base.place.name })
      : platform === "instagram"
        ? fieldsOf("instagram", { shareToFeed: true })
        : {};
  const [draft] = await db
    .insert(contentDrafts)
    .values({
      ideaId: base.idea.id,
      platform,
      text: outcome.parsed.text.trim(),
      title: spec.title ? (outcome.parsed.title?.trim() ?? null) : null,
      media,
      extra,
      promptVersion: PROMO_PROMPT_VERSION,
      playbookId: playbook?.id ?? null,
      llm: outcome.envelope(),
      // The funnel: it reaches new people and sends them to the video.
      stage: "reach",
      pointsTo: "video",
      videoDraft: base.video.id,
    })
    .returning();
  if (!draft) throw new Error("insert returned no row");
  await keepGenerated(db, llm, draft, outcome, { by: o.by });
  return { platform, ok: true, draft };
}

/**
 * A video's promo, in order: each platform's post (`posts`), the X thread, the carousel. The CLI's
 * path; the desk journals each one.
 */
export async function promoteVideo(
  db: Queryable,
  llm: LlmClient,
  videoDraft: string,
  platforms: readonly PromoPlatform[] = PROMO_PLATFORMS,
  o: DraftOptions & { pieces?: readonly PromoPiece[] } = {},
): Promise<{ ideaId: string; results: DraftResult[] }> {
  const base = await promoBase(db, videoDraft);
  const pieces = o.pieces ?? ["posts"];
  const results: DraftResult[] = [];
  if (pieces.includes("posts"))
    for (const p of platforms) results.push(await draftPromo(db, llm, base, p, o));
  if (pieces.includes("thread")) results.push(await draftThread(db, llm, base, o));
  if (pieces.includes("carousel")) results.push(...(await draftCarousel(db, llm, base, o)));
  return { ideaId: base.idea.id, results };
}

/** One row of a video's promos: a platform's post, the thread, or a carousel's draft. */
export interface PromoRow {
  id: string;
  platform: Platform;
  kind: PromoKind;
  status: string;
  text: string;
}

/** A promo's drafts, for the video's page: each platform's and piece's latest, with its state. */
export async function promosOf(db: Queryable, videoDraft: string): Promise<PromoRow[]> {
  const rows = await db
    .select({
      id: contentDrafts.id,
      platform: contentDrafts.platform,
      status: contentDrafts.status,
      text: contentDrafts.text,
      extra: contentDrafts.extra,
    })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(eq(contentIdeas.ref, promoRef(videoDraft)))
    .orderBy(sql`${contentDrafts.createdAt} desc`);
  const seen = new Set<string>();
  return rows.flatMap(({ extra, ...r }) => {
    const kind = promoKindOf({ platform: r.platform, extra });
    const key = `${r.platform}/${kind}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...r, kind }];
  });
}

/**
 * A promo prompt in the drafts' frame (voice, playbook, facts rule, lessons, the idea) with its
 * own brief and answer: `draftPrompt` with the answer line swapped.
 */
export async function piecePrompt(
  db: Queryable,
  base: PromoBase,
  platform: Platform,
  brief: { shape: string; maxChars: number; answer: string },
  o: DraftOptions,
): Promise<{ prompt: string; playbookId: string | null }> {
  const playbook = await playbookFor(db, platform);
  const full = draftPrompt(
    { text: base.idea.text, media: null },
    { ...PLATFORM_SPECS[platform], shape: brief.shape, maxChars: brief.maxChars },
    {
      voice: o.voice ?? DEFAULT_VOICE,
      brand: o.brand ?? DEFAULT_BRAND,
      lessons: await lessonsFor(db, platform),
      playbook,
      ...(o.facts ? { facts: o.facts } : {}),
    },
  );
  const cut = full.lastIndexOf("\nAnswer with JSON only");
  return {
    prompt: `${cut >= 0 ? full.slice(0, cut) : full}\nAnswer with JSON only, nothing before or after: ${brief.answer}`,
    playbookId: playbook?.id ?? null,
  };
}

const LINK_LINE =
  "The link to the video is added on its own line after the last post; never write a link or a URL.";

/** The thread's brief. */
export const THREAD_SHAPE = `a thread on X of ${THREAD_MIN} to ${THREAD_MAX} posts that sends people to a new YouTube video: dense and expert, written for people who already know the field. Post 1 is the sharpest claim from the video and stands alone: no link, no "thread", no "1/". Each next post adds one concrete point from the idea. The last post says the full walkthrough is in the video. Each post under 260 characters, the last under 220. No hashtags, no emoji, no numbering. ${LINK_LINE}`;

const threadAnswer = z.object({ posts: z.array(z.string()).min(1).max(12) });

/**
 * The promo's X thread: 3 to 7 posts in one draft, guarded post by post, pointing at the video.
 * The link rides on the last post once the video is up; the first carries none.
 */
export async function draftThread(
  db: Queryable,
  llm: LlmClient,
  base: PromoBase,
  o: DraftOptions = {},
): Promise<DraftResult> {
  const platform = "x" as const;
  if (!o.again && (await liveOf(db, base.idea.id)).has("x/thread"))
    return { platform, ok: false, reason: "thread already drafted" };
  const { prompt, playbookId } = await piecePrompt(
    db,
    base,
    platform,
    {
      shape: THREAD_SHAPE,
      maxChars: 260,
      answer: '{"posts": ["<post 1>", "<post 2>", "..."]}',
    },
    o,
  );
  const item = `idea:${base.idea.id}/x-thread`;
  const g = await guardParts(
    async (fix) => {
      const outcome = await completeAndParse(
        llm,
        fix ? `${prompt}\n\n${fix}` : prompt,
        threadAnswer,
        {
          maxTokens: 4000,
          runId: o.runId ?? null,
          tracer: o.tracer ?? null,
          name: DRAFT_STAGE,
          metadata: {
            platform,
            piece: "thread",
            ideaId: base.idea.id,
            video: base.video.id,
            version: PROMO_PROMPT_VERSION,
          },
        },
      );
      const posts = outcome.parsed?.posts.map((p) => p.trim()).filter(Boolean) ?? [];
      return {
        parts: posts.map((text, i) => ({ label: `post ${i + 1}`, text })),
        result: { outcome, posts },
      };
    },
    { facts: o.facts ?? [], sources: [], own: [base.idea.text, RECORDED] },
  );
  await recordGuard(db, DRAFT_STAGE, item, g);
  if (g.text === null) return { platform, ok: false, reason: droppedWhy(g) };
  const { outcome, posts } = g.result;
  if (!outcome.parsed)
    return {
      platform,
      ok: false,
      reason: outcome.providerRejected ?? outcome.parseError ?? "no answer",
    };
  // A post with a line of dashes would split in two: keep the model's posts as it meant them.
  const clean = posts.map((p) => p.replace(/^[ \t]*-{3,}[ \t]*$/gm, "").trim()).filter(Boolean);
  const bad = threadUnfit(clean);
  if (bad) return { platform, ok: false, reason: bad };
  const text = threadText(clean);
  const [draft] = await db
    .insert(contentDrafts)
    .values({
      ideaId: base.idea.id,
      platform,
      text,
      extra: fieldsOf("x", { kind: "thread" }),
      promptVersion: PROMO_PROMPT_VERSION,
      playbookId,
      llm: outcome.envelope(),
      stage: "reach",
      pointsTo: "video",
      videoDraft: base.video.id,
    })
    .returning();
  if (!draft) throw new Error("insert returned no row");
  await keepGenerated(db, llm, draft, outcome, { by: o.by });
  return { platform, ok: true, draft };
}

/** The carousel's brief: the slides and both posts in one answer. */
export const CAROUSEL_SHAPE = `a carousel of ${SLIDES_MIN} to ${SLIDES_MAX} slides that teaches the lesson of a new YouTube video, plus the two posts that carry it. Slide 1 is the hook: a title that states the problem or the result, and no lines. Each next slide makes one point from the idea: a title under ${SLIDE_TITLE_MAX - 15} characters and one to three short lines under ${SLIDE_LINE_MAX - 20} characters each. The last slide says the full walkthrough is on YouTube. "linkedin" is a LinkedIn post under 900 characters that goes with the slides as a PDF: a one-line hook, two or three short lines on what the slides show, a last line saying the full walkthrough is in the video. "instagram" is the Instagram caption: a first line that stands alone, two short lines, a line saying the full video is on YouTube, link in bio, then up to five hashtags on the last line. No emoji. Never write a link or a URL.`;

const carouselAnswer = z.object({
  slides: z
    .array(z.object({ title: z.string(), lines: z.array(z.string()).default([]) }))
    .min(1)
    .max(14),
  linkedin: z.string().min(1),
  instagram: z.string().min(1),
});

/**
 * The promo's carousel: one slide set, guarded slide by slide with both posts, drafted as a
 * LinkedIn document and an Instagram carousel that share it. Both point at the video.
 */
export async function draftCarousel(
  db: Queryable,
  llm: LlmClient,
  base: PromoBase,
  o: DraftOptions = {},
): Promise<DraftResult[]> {
  const fail = (reason: string): DraftResult[] => [
    { platform: "linkedin", ok: false, reason },
    { platform: "instagram", ok: false, reason },
  ];
  const live = await liveOf(db, base.idea.id);
  if (!o.again && (live.has("linkedin/carousel") || live.has("instagram/carousel")))
    return fail("carousel already drafted");
  const { prompt, playbookId } = await piecePrompt(
    db,
    base,
    "linkedin",
    {
      shape: CAROUSEL_SHAPE,
      maxChars: 900,
      answer:
        '{"slides": [{"title": "<title>", "lines": ["<line>", "..."]}, "..."], "linkedin": "<the LinkedIn post>", "instagram": "<the Instagram caption>"}',
    },
    o,
  );
  const g = await guardParts(
    async (fix) => {
      const outcome = await completeAndParse(
        llm,
        fix ? `${prompt}\n\n${fix}` : prompt,
        carouselAnswer,
        {
          maxTokens: 6000,
          runId: o.runId ?? null,
          tracer: o.tracer ?? null,
          name: DRAFT_STAGE,
          metadata: {
            platform: "linkedin",
            piece: "carousel",
            ideaId: base.idea.id,
            video: base.video.id,
            version: PROMO_PROMPT_VERSION,
          },
        },
      );
      const p = outcome.parsed;
      const slides = cleanSlides(p?.slides ?? []);
      return {
        parts: p
          ? [
              ...slides.map((s, i) => ({
                label: `slide ${i + 1}`,
                text: [s.title, ...s.lines].join("\n"),
              })),
              { label: "LinkedIn post", text: p.linkedin },
              { label: "Instagram caption", text: p.instagram },
            ]
          : [],
        result: { outcome, slides },
      };
    },
    { facts: o.facts ?? [], sources: [], own: [base.idea.text, RECORDED] },
  );
  await recordGuard(db, DRAFT_STAGE, `idea:${base.idea.id}/carousel`, g);
  if (g.text === null) return fail(droppedWhy(g));
  const { outcome, slides } = g.result;
  const p = outcome.parsed;
  if (!p) return fail(outcome.providerRejected ?? outcome.parseError ?? "no answer");
  const bad =
    slidesUnfit(slides) ??
    (p.linkedin.trim().length > PLATFORM_SPECS.linkedin.maxChars
      ? `the LinkedIn post is over ${PLATFORM_SPECS.linkedin.maxChars} characters`
      : p.instagram.trim().length > PLATFORM_SPECS.instagram.maxChars
        ? `the caption is over ${PLATFORM_SPECS.instagram.maxChars} characters`
        : null);
  if (bad) return fail(bad);
  const deck = randomUUID();
  const common = {
    ideaId: base.idea.id,
    promptVersion: PROMO_PROMPT_VERSION,
    playbookId,
    llm: outcome.envelope(),
    stage: "reach" as const,
    pointsTo: "video" as const,
    videoDraft: base.video.id,
  };
  const rows = await db
    .insert(contentDrafts)
    .values([
      {
        ...common,
        platform: "linkedin",
        text: p.linkedin.trim(),
        extra: fieldsOf("linkedin", { kind: "document", deck, slides }),
      },
      {
        ...common,
        platform: "instagram",
        text: p.instagram.trim(),
        extra: fieldsOf("instagram", { kind: "carousel", deck, slides }),
      },
    ])
    .returning();
  const out: DraftResult[] = [];
  for (const d of rows) {
    await keepGenerated(db, llm, d, outcome, { by: o.by });
    out.push({ platform: d.platform, ok: true, draft: d });
  }
  return out;
}

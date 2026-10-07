/**
 * Promo posts (designs/2026-10-07-content-funnel.md): one YouTube video → one draft per platform,
 * each in its platform's tone, pointing at the video. The video's own title and description are
 * the idea, so the facts guard holds every claim to his words. Nothing posts: each draft waits in
 * To approve, and its link fills in from the video once it is on YouTube.
 *
 * Reddit stays organic: the lesson as its own post, first person, no pitch, in the best-fit
 * watched subreddit that takes posts; it mentions the video only where that sub allows links.
 * Instagram can't post words alone, so its promo rides on the video's vertical cut or first Short.
 */
import type { Platform } from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";
import type { Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { videoEdits } from "@wren/studio/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  askGuarded,
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

/** A video that can be promoted: approved to upload, uploading or up. */
const PROMOTABLE = ["approved", "publishing", "published"] as const;

/** True of every promo, and the Reddit brief may say it: backs "I recorded a walkthrough". */
const RECORDED = "I recorded a walkthrough video of this.";

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
 * The promo's idea for a YouTube video draft, made once (ref `promo:<draft>`): the video's title
 * and description without its footer. Refuses a Short, or a video not approved to go up.
 */
export async function promoBase(db: Queryable, videoDraft: string): Promise<PromoBase> {
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

/** Drafts already made for this promo, by platform, not turned down. */
async function liveOf(db: Queryable, ideaId: string): Promise<Map<Platform, string>> {
  const rows = await db
    .select({ id: contentDrafts.id, platform: contentDrafts.platform })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.ideaId, ideaId),
        inArray(contentDrafts.status, ["draft", "approved", "publishing", "published"]),
      ),
    );
  return new Map(rows.map((r) => [r.platform, r.id]));
}

/** Why the platform's promo can't be drafted, or null. */
export async function promoSkip(
  db: Queryable,
  base: PromoBase,
  platform: PromoPlatform,
  again = false,
): Promise<string | null> {
  if (!again && (await liveOf(db, base.idea.id)).has(platform)) return "already drafted";
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

/** Every platform's promo for one video, in order. The CLI's path; the desk journals each one. */
export async function promoteVideo(
  db: Queryable,
  llm: LlmClient,
  videoDraft: string,
  platforms: readonly PromoPlatform[] = PROMO_PLATFORMS,
  o: DraftOptions = {},
): Promise<{ ideaId: string; results: DraftResult[] }> {
  const base = await promoBase(db, videoDraft);
  const results: DraftResult[] = [];
  for (const p of platforms) results.push(await draftPromo(db, llm, base, p, o));
  return { ideaId: base.idea.id, results };
}

/** A promo's drafts, for the video's page: each platform's latest, with its state. */
export async function promosOf(
  db: Queryable,
  videoDraft: string,
): Promise<{ id: string; platform: Platform; status: string; text: string }[]> {
  const rows = await db
    .select({
      id: contentDrafts.id,
      platform: contentDrafts.platform,
      status: contentDrafts.status,
      text: contentDrafts.text,
    })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(eq(contentIdeas.ref, promoRef(videoDraft)))
    .orderBy(sql`${contentDrafts.createdAt} desc`);
  const seen = new Set<Platform>();
  return rows.filter((r) => !seen.has(r.platform) && seen.add(r.platform));
}

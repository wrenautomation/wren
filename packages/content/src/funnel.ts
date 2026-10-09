/**
 * The funnel on a post (designs/2026-10-07-content-funnel.md): video → site → booking. Every draft
 * says which stage it serves and where it points; the link it carries is derived from that, never
 * typed, so it can't go stale when the video uploads or the target changes. `linked` is his only
 * stored choice: null follows the platform's rule. Every link of Wren's goes through the lander's
 * `/go/`, a video's too (`?v=`), so each click is counted against its post.
 */
import { recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { PLATFORM_SPECS } from "./platforms.js";
import {
  type ContentDraft,
  contentDrafts,
  type DraftStatus,
  FUNNEL_STAGES,
  FUNNEL_TARGETS,
  type FunnelStage,
  type FunnelTarget,
} from "./schema.js";

export const STAGE_LABELS: Record<FunnelStage, string> = {
  reach: "Reach",
  trust: "Trust",
  convert: "Convert",
};
export const TARGET_LABELS: Record<FunnelTarget, string> = {
  video: "The video",
  site: "The site",
  booking: "Booking",
  page: "A page",
};

/** Wren's site: the lander the footers already name. */
export const WREN_SITE = "https://wrenautomation.com";
/** The one offer with a booking page. */
export const BOOKING_PATH = "/book/reactivation";

type FunnelRow = Pick<
  ContentDraft,
  "id" | "platform" | "text" | "extra" | "stage" | "pointsTo" | "videoDraft" | "sitePage" | "linked"
>;

/** The YouTube draft a post points at. */
export interface FunnelVideo {
  id: string;
  title: string | null;
  url: string | null;
  status: DraftStatus;
}

/** A Sites page a post points at: Wren's own, served at `/o/<slug>`. */
export interface FunnelPage {
  id: string;
  title: string;
  slug: string;
  live: boolean;
}

/** What the rule reads past the row: the video, the page, the subreddit's word on links, whose database. */
export interface FunnelContext {
  video: FunnelVideo | null;
  page?: FunnelPage | null;
  /** Reddit only: the watched place named in the draft's subreddit field, if researched. */
  place: { name: string; links: boolean } | null;
  /** A client's database: its posts never carry Wren's link. */
  client: boolean;
}

/** The post's funnel as the editor and CLI show it. */
export interface FunnelView {
  stage: FunnelStage;
  to: FunnelTarget;
  video: FunnelVideo | null;
  page: FunnelPage | null;
  /** His choice, or the rule's when he made none. */
  linked: boolean;
  /** He set it himself. */
  chosen: boolean;
  /** The platform and place allow a link at all. */
  allowed: boolean;
  /** The target's link, whether or not the post carries it. */
  link: string | null;
  /** What the post will end with; null: nothing appended. */
  posts: string | null;
  /** Why it carries no link, in a few words. */
  note: string | null;
}

const isShort = (d: Pick<ContentDraft, "platform" | "extra">) =>
  d.platform === "youtube" && d.extra?.kind === "short";

/** A YouTube video's id from its URL (`watch?v=`, `youtu.be/`, `shorts/`), or null. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const id =
    host === "youtu.be"
      ? u.pathname.slice(1)
      : host === "youtube.com"
        ? (u.searchParams.get("v") ?? /^\/(?:shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? "")
        : "";
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** The lander's tracked link for a post: `/go/<channel>/<stage>/<first 8 of the draft id>`. */
const goLink = (d: Pick<FunnelRow, "id" | "platform" | "stage">) =>
  `${WREN_SITE}/go/${PLATFORM_SPECS[d.platform].goCode}/${d.stage}/${d.id.slice(0, 8)}`;

/**
 * The target's link. Wren's posts go through the lander's `/go/<channel>/<stage>/<post>`, which
 * counts the click: to the video with `?v=<YouTube id>` (none until it's up), to booking or a
 * Sites page with `?to=`. A client's post links only its own video, straight: Wren's lander never
 * carries a client's traffic.
 */
export function targetLink(
  d: FunnelRow,
  video: FunnelVideo | null,
  client = false,
  page: FunnelPage | null = null,
): string | null {
  if (d.pointsTo === "video") {
    if (!video?.url) return null;
    const id = client ? null : youtubeId(video.url);
    return id ? `${goLink(d)}?v=${id}` : video.url;
  }
  if (client) return null;
  if (d.pointsTo === "page") return page ? `${goLink(d)}?to=/o/${page.slug}` : null;
  return d.pointsTo === "booking" ? `${goLink(d)}?to=${BOOKING_PATH}` : goLink(d);
}

/**
 * Whether the platform takes a link (`allowed`) and whether it carries one by default (`on`).
 * A link costs reach on X and Reddit, so only a promo carries one there.
 */
export function linkRule(
  d: Pick<FunnelRow, "platform" | "extra" | "pointsTo">,
  place: FunnelContext["place"],
): { allowed: boolean; on: boolean; why: string | null } {
  const promo = d.pointsTo === "video";
  switch (d.platform) {
    case "google_business":
      return { allowed: false, on: false, why: "The post's button carries the link" };
    case "instagram":
    case "tiktok":
      return {
        allowed: false,
        on: false,
        why: "Not clickable in a caption: the bio link counts it",
      };
    case "youtube":
      return isShort(d)
        ? { allowed: false, on: false, why: "A Short's links can't be clicked" }
        : { allowed: true, on: true, why: null };
    case "linkedin":
    case "facebook":
      return { allowed: true, on: true, why: null };
    case "x":
      return promo
        ? { allowed: true, on: true, why: null }
        : { allowed: true, on: false, why: "A link costs reach on X: only promos carry one" };
    case "reddit":
      if (!place)
        return {
          allowed: false,
          on: false,
          why: "Not a researched subreddit: no link, to be safe",
        };
      if (!place.links)
        return { allowed: false, on: false, why: `r/${place.name} doesn't allow links` };
      return promo
        ? { allowed: true, on: true, why: null }
        : { allowed: true, on: false, why: "Reddit posts stay organic: only promos link" };
  }
}

/** The funnel of a draft, given its context. Pure: the scheduler and the editor read the same. */
export function funnelOf(d: FunnelRow, ctx: FunnelContext): FunnelView {
  const rule = linkRule(d, ctx.place);
  const page = ctx.page ?? null;
  const link = targetLink(d, ctx.video, ctx.client, page);
  const linked = d.linked ?? rule.on;
  const inText =
    Boolean(link && d.text.includes(link)) || d.text.includes(`${WREN_SITE.slice(8)}/go/`);
  const note =
    ctx.client && d.pointsTo !== "video"
      ? "A client's posts link only its own videos"
      : !rule.allowed
        ? rule.why
        : !linked
          ? d.linked === false
            ? "Off for this post"
            : rule.why
          : !link
            ? d.pointsTo === "page"
              ? "Pick the page it points to"
              : ctx.video
                ? "Fills in when the video is on YouTube"
                : "Pick the video it points to"
            : d.pointsTo === "page" && !page?.live
              ? "Its page isn't live yet: approve it in Sites first"
              : inText
                ? "Already in the text"
                : null;
  return {
    stage: d.stage,
    to: d.pointsTo,
    video: ctx.video,
    page,
    linked,
    chosen: d.linked !== null,
    allowed: rule.allowed,
    link,
    posts: note === null ? link : null,
    note,
  };
}

/** The subreddit in a Reddit draft's field, lowercase, without r/. */
const subredditOf = (extra: Record<string, unknown> | null | undefined): string | null => {
  const s = extra?.subreddit;
  return typeof s === "string" && s.trim() ? s.trim().replace(/^r\//i, "").toLowerCase() : null;
};

/** Wren's Sites page by id: `site_pages` is Sites' table, read by SQL as `reddit_places` is. */
async function pageOf(db: Queryable, id: string): Promise<FunnelPage | null> {
  const [p] = await db.execute<{ id: string; title: string; slug: string; status: string }>(
    sql`select id::text, title, slug, status from site_pages
        where id = ${id} and client is null and source = 'data'`,
  );
  return p ? { id: p.id, title: p.title, slug: p.slug, live: p.status === "live" } : null;
}

/** Wren's data pages a post may point at, live first: the editor's picker. */
export async function pickablePages(db: Queryable): Promise<FunnelPage[]> {
  const rows = await db.execute<{ id: string; title: string; slug: string; status: string }>(
    sql`select id::text, title, slug, status from site_pages
        where client is null and source = 'data' and status <> 'retired'
        order by (status = 'live') desc, updated_at desc limit 50`,
  );
  return rows.map((p) => ({ id: p.id, title: p.title, slug: p.slug, live: p.status === "live" }));
}

/** Read the context: the video row, the place's rules, whose database this is. */
export async function funnelContext(db: Queryable, d: FunnelRow): Promise<FunnelContext> {
  const [video] = d.videoDraft
    ? await db
        .select({
          id: contentDrafts.id,
          title: contentDrafts.title,
          url: contentDrafts.url,
          status: contentDrafts.status,
        })
        .from(contentDrafts)
        .where(eq(contentDrafts.id, d.videoDraft))
        .limit(1)
    : [];
  const sub = d.platform === "reddit" ? subredditOf(d.extra) : null;
  // reddit_places is outreach's table: read by SQL, so content doesn't import outreach.
  const [row] = await db.execute<{ client: boolean; name: string | null; links: boolean | null }>(
    sql`select current_database() like 'wren\_client\_%' client, p.name,
          coalesce((p.judged->>'mayPost')::boolean and not (p.judged->>'linkOnly')::boolean, false) links
        from (select 1) one left join reddit_places p on p.subreddit = ${sub}`,
  );
  return {
    video: video ?? null,
    page: d.sitePage ? await pageOf(db, d.sitePage) : null,
    place: sub && row?.name ? { name: row.name, links: row.links === true } : null,
    client: row?.client === true,
  };
}

/** A draft's funnel, read whole. */
export async function readFunnel(db: Queryable, d: FunnelRow): Promise<FunnelView> {
  return funnelOf(d, await funnelContext(db, d));
}

/** The link the post goes out with, or null: what the scheduler appends. */
export async function postedLink(db: Queryable, d: FunnelRow): Promise<string | null> {
  return (await readFunnel(db, d)).posts;
}

export interface FunnelPatch {
  stage?: FunnelStage;
  to?: FunnelTarget;
  /** The YouTube draft it points at; null clears it. */
  video?: string | null;
  /** The Sites page it points at; null clears it. */
  page?: string | null;
  /** On, off, or null: back to the platform's rule. */
  linked?: boolean | null;
}

const EDITABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];

/**
 * Set a draft's stage, target, video or link. Like a field, it leaves an approved draft approved:
 * where it points is not what it says. The draft record keeps before and after.
 */
export async function setFunnel(
  db: Queryable,
  id: string,
  patch: FunnelPatch,
  who?: { by: string },
): Promise<ContentDraft> {
  const [d] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).limit(1);
  if (!d) throw new Error(`no draft ${id}`);
  if (!EDITABLE.includes(d.status)) throw new Error(`cannot change ${id}: it is ${d.status}`);
  if (patch.stage !== undefined && !FUNNEL_STAGES.includes(patch.stage))
    throw new Error(`stage is one of ${FUNNEL_STAGES.join(", ")}`);
  if (patch.to !== undefined && !FUNNEL_TARGETS.includes(patch.to))
    throw new Error(`points to one of ${FUNNEL_TARGETS.join(", ")}`);
  if (patch.video) {
    if (patch.video === id) throw new Error("a post can't point at itself");
    const [v] = await db
      .select({ platform: contentDrafts.platform, extra: contentDrafts.extra })
      .from(contentDrafts)
      .where(eq(contentDrafts.id, patch.video))
      .limit(1);
    if (v?.platform !== "youtube" || isShort(v))
      throw new Error(`${patch.video} isn't a YouTube video`);
  }
  if (patch.page && !(await pageOf(db, patch.page)))
    throw new Error(`${patch.page} isn't one of Wren's Sites pages`);
  const next = {
    stage: patch.stage ?? d.stage,
    pointsTo: patch.to ?? d.pointsTo,
    videoDraft: patch.video !== undefined ? patch.video : d.videoDraft,
    sitePage: patch.page !== undefined ? patch.page : d.sitePage,
    linked: patch.linked !== undefined ? patch.linked : d.linked,
  };
  const changed: Record<string, [unknown, unknown]> = {};
  for (const k of ["stage", "pointsTo", "videoDraft", "sitePage", "linked"] as const)
    if (next[k] !== d[k]) changed[k] = [d[k], next[k]];
  if (Object.keys(changed).length === 0) return d;
  const [row] = await db
    .update(contentDrafts)
    .set(next)
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(`no draft ${id}`);
  if (who)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: row.platform,
      event: "edited",
      via: "person",
      by: who.by,
      text: row.text,
      title: row.title,
      meta: { funnel: changed },
    });
  return row;
}

/**
 * Approve refuses a post that would go out pointing at a video not yet up, or at a page that
 * isn't live: its link would be missing or dead. He approves it once the target is up, or turns
 * the link off.
 */
export async function refuseUnlinked(db: Queryable, rows: readonly FunnelRow[]): Promise<void> {
  const waiting: string[] = [];
  for (const r of rows) {
    if (r.pointsTo !== "video" && r.pointsTo !== "page") continue;
    const ctx = await funnelContext(db, r);
    const f = funnelOf(r, ctx);
    if (!f.linked || !f.allowed) continue;
    if (r.pointsTo === "page") {
      // A client's post carries no page link (the note says so): nothing to wait on.
      if (ctx.client) continue;
      if (!f.page) waiting.push(`${r.id}: pick the page it points to, or turn the link off`);
      else if (!f.page.live)
        waiting.push(`${r.id}: its page /o/${f.page.slug} isn't live; approve it in Sites first`);
      continue;
    }
    if (f.link) continue;
    waiting.push(
      f.video
        ? `${r.id}: its video isn't on YouTube yet; approve once it is, or turn the link off`
        : `${r.id}: pick the video it points to, or turn the link off`,
    );
  }
  if (waiting.length > 0) throw new Error(`cannot approve: ${waiting.join("; ")}`);
}

/** Stage, target and link in one line, for the CLI. */
export const funnelLine = (f: Pick<FunnelView, "stage" | "to" | "posts" | "note">): string =>
  `${STAGE_LABELS[f.stage]} → ${TARGET_LABELS[f.to]}${f.posts ? `  ${f.posts}` : f.note ? `  (no link: ${f.note})` : ""}`;

/**
 * Pieces (designs/2026-10-13-primitives-first.md): what William makes, each once, with where it
 * went hanging under it. A long video carries its clips and its promo posts; a clip, a post or a
 * story carries one branch per platform; a blog post carries the site and the email. Lineage is
 * what the rows already say: an idea's `ref` (`video:<id>`, `video:<id>/short:<n>`, a post about
 * it `video:<id>/post:<k>`), a promo draft's `video_draft`, and `blog_posts` (its `from_ref`
 * nests it under a video). Nothing is stored here.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type BlogRow, blogRows } from "./blog.js";
import { formatSql } from "./schema.js";

export const PIECE_KINDS = ["long", "vertical", "written", "story", "blog"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

/**
 * A branch's state: `draft` and `failed` wait on him, `queued` is approved for a time, `live` went
 * out. `editing` is a recording (or a proposed Short) still in the editor, `review` one rendered
 * and waiting on his look in Studio; `none` is a branch not made yet (a blog post's email before
 * it's sent).
 */
export type BranchState =
  | "draft"
  | "failed"
  | "queued"
  | "publishing"
  | "live"
  | "editing"
  | "review"
  | "none";

export interface Branch {
  /** The draft's id; a blog's `blog:<slug>/site`; a recording's `video:<id>` (a proposed Short's
   * `video:<id>/short:<n>`). */
  id: string;
  /** A platform, or `site`, `email`, `editor`. */
  platform: string;
  /** The draft's format (`formatSql`): long, short, reel, post, story, thread... */
  format: string;
  state: BranchState;
  /** When it went out, or is set to; null while it waits. */
  at: string | null;
  url: string | null;
  views: number | null;
  /** Reactions, comments and shares, newest look. */
  engaged: number | null;
  error: string | null;
}

export interface Piece {
  /** The idea's id; `video:<id>` for a recording with no idea yet; `blog:<slug>`. */
  id: string;
  kind: PieceKind;
  title: string;
  /** The words, as the first draft or the idea has them. */
  text: string;
  /** Its newest moment: made, approved or out. Pieces sort on it. */
  at: string;
  branches: Branch[];
  /** A long video's clips and promo posts. */
  children: Piece[];
  /** A long video's recording (`video_edits.id`): what a post or blog post is written from. */
  video?: number;
}

export interface DraftRow {
  id: string;
  idea_id: string;
  platform: string;
  format: string;
  status: string;
  title: string | null;
  text: string;
  scheduled_for: string | Date | null;
  published_at: string | Date | null;
  url: string | null;
  error: string | null;
  video_draft: string | null;
  created_at: string | Date;
  views: number | null;
  engaged: number | null;
}
export interface IdeaRow {
  id: string;
  text: string;
  ref: string | null;
  created_at: string | Date;
}
export interface VideoRow {
  id: number;
  title: string;
  /** `video_edits.state`; rejected rows never reach here. */
  state: string;
  /** The Shorts the editor proposed, in order: `short:<n>` is `shorts[n-1]`. */
  shorts: readonly { title: string }[];
  created_at: string | Date;
}
export interface PieceRows {
  drafts: readonly DraftRow[];
  ideas: readonly IdeaRow[];
  videos: readonly VideoRow[];
  blogs: readonly Pick<
    BlogRow,
    | "slug"
    | "title"
    | "description"
    | "draft"
    | "publishedAt"
    | "emailedAt"
    | "createdAt"
    | "fromRef"
  >[];
  /** The site blog posts go up on: `https://wrenautomation.com`. */
  site: string;
}

const rowsOf = async <T>(db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as T[];
const iso = (d: string | Date | null | undefined) =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString();
const latest = (...ds: (string | null)[]) =>
  ds.filter((d): d is string => !!d).reduce((a, b) => (a > b ? a : b), "");
const VERTICAL = new Set(["short", "reel", "video"]);
const LONG_REF = /^video:(\d+)$/;
const CLIP_REF = /^video:(\d+)\/(short:\d+|vertical)$/;
/** Anything made from a long video (a clip, `post:<k>`): it nests under it. */
const FROM_VIDEO = /^video:(\d+)\/./;

function stateOf(d: DraftRow): BranchState {
  switch (d.status) {
    case "published":
      return "live";
    case "approved":
      return "queued";
    case "publishing":
      return "publishing";
    case "failed":
      return "failed";
    default:
      return "draft";
  }
}

function branchOf(d: DraftRow): Branch {
  return {
    id: d.id,
    platform: d.platform,
    format: d.format,
    state: stateOf(d),
    at: iso(d.published_at) ?? (d.status === "approved" ? iso(d.scheduled_for) : null),
    url: d.url,
    views: d.views,
    engaged: d.engaged,
    error: d.status === "failed" ? d.error : null,
  };
}

/** The first line of some words, 90 characters at most. */
export function titleOf(words: string): string {
  const line = words.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line;
}

/** The rows as pieces, newest first; a long video's clips and promos under it. */
export function piecesOf(rows: PieceRows): Piece[] {
  const byIdea = new Map<string, DraftRow[]>();
  for (const d of rows.drafts) byIdea.set(d.idea_id, [...(byIdea.get(d.idea_id) ?? []), d]);
  const ideaOfDraft = new Map(rows.drafts.map((d) => [d.id, d.idea_id]));

  const pieces = new Map<string, Piece>();
  /** A piece's parent: its long video's piece id. */
  const parent = new Map<string, string>();
  const longOfVideo = new Map<number, string>();

  for (const idea of rows.ideas) {
    const drafts = (byIdea.get(idea.id) ?? []).sort((a, b) => a.platform.localeCompare(b.platform));
    const ref = idea.ref ?? "";
    const long = LONG_REF.exec(ref);
    const clip = CLIP_REF.exec(ref);
    const formats = drafts.map((d) => d.format);
    const kind: PieceKind = long
      ? "long"
      : clip || (formats.length && formats.every((f) => VERTICAL.has(f)))
        ? "vertical"
        : formats.length && formats.every((f) => f === "story")
          ? "story"
          : "written";
    const first = drafts.find((d) => d.title) ?? drafts[0];
    const branches = drafts.map(branchOf);
    pieces.set(idea.id, {
      id: idea.id,
      kind,
      title: titleOf(first?.title || idea.text),
      text: first?.text ?? idea.text,
      at: latest(iso(idea.created_at), ...branches.map((b) => b.at)),
      branches,
      children: [],
    });
    if (long) {
      longOfVideo.set(Number(long[1]), idea.id);
      (pieces.get(idea.id) as Piece).video = Number(long[1]);
    }
    // A promo points at the YouTube draft; its long video is that draft's idea.
    const promoOf = drafts.find((d) => d.video_draft)?.video_draft;
    const up = promoOf ? ideaOfDraft.get(promoOf) : undefined;
    if (up && up !== idea.id) parent.set(idea.id, up);
  }

  // A recording with no idea yet is a long video still in the editor: rendered, it waits on
  // his look in Studio.
  const editorOf = (id: string, format: string, state: BranchState): Branch => ({
    id,
    platform: "editor",
    format,
    state,
    at: null,
    url: null,
    views: null,
    engaged: null,
    error: null,
  });
  const clipRefs = new Set(rows.ideas.map((i) => i.ref ?? "").filter((r) => CLIP_REF.test(r)));
  for (const v of rows.videos) {
    const at = iso(v.created_at) ?? "";
    // A proposed Short with no idea yet is a clip still in the editor, under its long video.
    v.shorts.forEach((s, n) => {
      const id = `video:${v.id}/short:${n + 1}`;
      if (clipRefs.has(id)) return;
      pieces.set(id, {
        id,
        kind: "vertical",
        title: titleOf(s.title) || `Short ${n + 1}`,
        text: "",
        at,
        branches: [editorOf(id, "short", "editing")],
        children: [],
      });
    });
    if (longOfVideo.has(v.id)) {
      const p = pieces.get(longOfVideo.get(v.id) as string);
      if (p && v.title) p.title = titleOf(v.title);
      continue;
    }
    const id = `video:${v.id}`;
    pieces.set(id, {
      id,
      kind: "long",
      title: titleOf(v.title) || `Recording ${v.id}`,
      text: "",
      at,
      branches: [editorOf(id, "long", v.state === "rendered" ? "review" : "editing")],
      children: [],
      video: v.id,
    });
    longOfVideo.set(v.id, id);
  }
  for (const v of rows.videos)
    v.shorts.forEach((_, n) => {
      const id = `video:${v.id}/short:${n + 1}`;
      const up = longOfVideo.get(v.id);
      if (up && pieces.has(id)) parent.set(id, up);
    });
  for (const idea of rows.ideas) {
    const from = FROM_VIDEO.exec(idea.ref ?? "");
    const up = from ? longOfVideo.get(Number(from[1])) : undefined;
    if (up) parent.set(idea.id, up);
  }

  for (const b of rows.blogs) {
    const id = `blog:${b.slug}`;
    const out = iso(b.publishedAt);
    const mailed = iso(b.emailedAt);
    const blank = { format: "post", views: null, engaged: null, error: null };
    pieces.set(id, {
      id,
      kind: "blog",
      title: titleOf(b.title),
      text: b.description,
      at: latest(iso(b.createdAt), out, mailed),
      branches: [
        {
          ...blank,
          id: `${id}/site`,
          platform: "site",
          state: b.draft ? "draft" : "live",
          at: b.draft ? null : out,
          url: b.draft ? null : `${rows.site}/blog/${b.slug}`,
        },
        {
          ...blank,
          id: `${id}/email`,
          platform: "email",
          state: mailed ? "live" : "none",
          at: mailed,
          url: null,
        },
      ],
      children: [],
    });
    // Written from a long video: it hangs under it (`blog_posts.from_ref`).
    const from = LONG_REF.exec(b.fromRef ?? "");
    const up = from ? longOfVideo.get(Number(from[1])) : undefined;
    if (up) parent.set(id, up);
  }

  for (const [child, up] of parent) {
    const c = pieces.get(child);
    const p = pieces.get(up);
    if (!c || !p) continue;
    p.children.push(c);
    p.at = latest(p.at, c.at);
    pieces.delete(child);
  }
  const newest = (a: Piece, b: Piece) => b.at.localeCompare(a.at);
  for (const p of pieces.values()) p.children.sort(newest);
  return [...pieces.values()].sort(newest);
}

/**
 * The branches waiting on him: a piece's own, not its children's. A rendered recording (`review`)
 * counts, though Approve all leaves it out: a cut needs one look.
 */
export const waitingOf = (p: Pick<Piece, "branches">) =>
  p.branches.filter((b) => b.state === "draft" || b.state === "failed" || b.state === "review");

/** The last `days` days of pieces, rejected drafts and recordings left out. */
export async function pieceRows(db: Queryable, site: string, days = 120): Promise<PieceRows> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const drafts = await rowsOf<DraftRow>(
    db,
    sql`select d.id, d.idea_id, d.platform, ${sql.raw(formatSql)} format, d.status, d.title,
        left(d.text, 600) text, d.scheduled_for, d.published_at, d.url, d.error, d.video_draft,
        d.created_at, m.views, m.engaged
      from content_drafts d
      left join lateral (
        select views, reactions + comments + shares engaged from content_metrics
        where draft_id = d.id order by as_of desc limit 1
      ) m on true
      where d.status <> 'rejected'
        and (d.created_at >= ${since}::timestamptz or d.published_at >= ${since}::timestamptz)`,
  );
  const ideas = await rowsOf<IdeaRow>(
    db,
    sql`select id, left(text, 600) text, ref, created_at from content_ideas
      where id in (select d.idea_id from content_drafts d
          where d.status <> 'rejected'
            and (d.created_at >= ${since}::timestamptz or d.published_at >= ${since}::timestamptz))
        or (status = 'open' and created_at >= ${since}::timestamptz)`,
  );
  const videos = await rowsOf<VideoRow>(
    db,
    sql`select id, title, state,
        coalesce((select jsonb_agg(jsonb_build_object('title', s->>'title') order by n)
          from jsonb_array_elements(shorts) with ordinality as x(s, n)), '[]'::jsonb) shorts,
        created_at
      from video_edits
      where created_at >= ${since}::timestamptz and state <> 'rejected'`,
  );
  const blogs = await blogRows(db, 100);
  return { drafts, ideas, videos, blogs, site };
}

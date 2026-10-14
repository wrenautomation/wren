/**
 * The blog from Write (designs/2026-10-13-blog-box.md). A post is one Markdown file in the
 * lander repo (`src/content/blog/<slug>.md`), so the site stays the source and a push deploys
 * it. Wren commits the file through GitHub's contents API with a token for that one repo, and
 * keeps a row per post (`blog_posts`): what Write lists, what Plan counts, when it was mailed.
 */
import type { Queryable } from "@wren/db";
import { desc, eq, sql } from "drizzle-orm";
import { blogPosts } from "./schema.js";

export const BLOG_DIR = "src/content/blog";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BlogPost {
  slug: string;
  title: string;
  /** The search snippet and the line under the title, ~155 characters. */
  description: string;
  /** Markdown. */
  body: string;
  /** The day it goes up, YYYY-MM-DD. */
  date: string;
  draft: boolean;
}

/** A slug from a title: lower case words joined by dashes, at most 80 characters. */
export function slugOf(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return s || "post";
}

/** Why a post can't go up as it is, or null. */
export function blogProblem(p: Pick<BlogPost, "slug" | "title" | "description" | "body">) {
  if (!SLUG.test(p.slug) || p.slug === "how-to-post") return "the address can't be used";
  if (!p.title.trim()) return "it needs a title";
  if (p.title.length > 120) return "the title is over 120 characters";
  if (!p.description.trim()) return "it needs a one-line description";
  if (p.description.length > 300) return "the description is over 300 characters";
  if (!p.body.trim()) return "it has no words yet";
  return null;
}

/** The file the lander reads: frontmatter its schema checks, then the Markdown. */
export function blogFile(p: BlogPost): string {
  // JSON strings are valid YAML double-quoted scalars, so any title survives.
  return [
    "---",
    `title: ${JSON.stringify(p.title.trim())}`,
    `description: ${JSON.stringify(p.description.trim())}`,
    `date: ${p.date}`,
    `draft: ${p.draft}`,
    "---",
    "",
    `${p.body.trim()}\n`,
  ].join("\n");
}

/** The lander repo, as far as Write needs it: read a file, write one as a commit. */
export interface LanderRepo {
  read(path: string): Promise<{ text: string; sha: string } | null>;
  /** Commits `text` at `path`; answers the commit's sha. Unchanged text commits nothing. */
  write(path: string, text: string, message: string): Promise<string | null>;
}

/** GitHub's contents API on `repo` ("owner/name"), main branch, with a token for that repo. */
export function githubRepo(o: {
  token: string;
  repo: string;
  branch?: string;
  fetch?: typeof fetch;
}): LanderRepo {
  const f = o.fetch ?? fetch;
  const branch = o.branch ?? "main";
  const at = (path: string) =>
    `https://api.github.com/repos/${o.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = {
    authorization: `Bearer ${o.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "wren-blog",
  };
  const fail = async (res: Response, what: string) => {
    const why = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    return new Error(`github ${what}: HTTP ${res.status}${why ? ` (${why})` : ""}`);
  };
  async function read(path: string) {
    const res = await f(`${at(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw await fail(res, `read ${path}`);
    const b = (await res.json()) as { content?: string; sha: string };
    return { text: Buffer.from(b.content ?? "", "base64").toString("utf8"), sha: b.sha };
  }
  return {
    read,
    async write(path, text, message) {
      const now = await read(path);
      // A retry after a commit that landed finds its own text: nothing to do.
      if (now?.text === text) return null;
      const res = await f(at(path), {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          message,
          branch,
          content: Buffer.from(text, "utf8").toString("base64"),
          ...(now ? { sha: now.sha } : {}),
        }),
      });
      if (!res.ok) throw await fail(res, `write ${path}`);
      return ((await res.json()) as { commit?: { sha?: string } }).commit?.sha ?? null;
    },
  };
}

export type BlogRow = typeof blogPosts.$inferSelect;

/** Posts newest first: drafts and published, for Write's list. */
export async function blogRows(db: Queryable, limit = 30): Promise<BlogRow[]> {
  return db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt)).limit(limit);
}

export async function blogRow(db: Queryable, slug: string): Promise<BlogRow | null> {
  const [r] = await db.select().from(blogPosts).where(eq(blogPosts.slug, slug));
  return r ?? null;
}

/** Records a commit: the row as written, `publishedAt` set the first time it goes up. */
export async function keepBlogRow(
  db: Queryable,
  p: BlogPost,
  o: {
    commit: string | null;
    by: string;
    now: Date;
    /** What it was written from (`video:<id>`); null clears it, absent keeps it. */
    from?: string | null;
  },
): Promise<BlogRow> {
  const published = p.draft ? null : o.now;
  const [r] = await db
    .insert(blogPosts)
    .values({
      slug: p.slug,
      title: p.title,
      description: p.description,
      body: p.body,
      date: p.date,
      draft: p.draft,
      publishedAt: published,
      commitSha: o.commit,
      fromRef: o.from ?? null,
      updatedBy: o.by,
      updatedAt: o.now,
    })
    .onConflictDoUpdate({
      target: blogPosts.slug,
      set: {
        title: p.title,
        description: p.description,
        body: p.body,
        date: p.date,
        draft: p.draft,
        publishedAt: p.draft
          ? sql`null`
          : sql`coalesce(${blogPosts.publishedAt}, ${o.now.toISOString()}::timestamptz)`,
        commitSha: sql`coalesce(${o.commit}, ${blogPosts.commitSha})`,
        ...(o.from !== undefined ? { fromRef: o.from } : {}),
        updatedBy: o.by,
        updatedAt: o.now,
      },
    })
    .returning();
  if (!r) throw new Error(`blog: ${p.slug} was not kept`);
  return r;
}

export async function markEmailed(db: Queryable, slug: string, at: Date): Promise<void> {
  await db
    .update(blogPosts)
    .set({ emailedAt: sql`coalesce(${blogPosts.emailedAt}, ${at.toISOString()}::timestamptz)` })
    .where(eq(blogPosts.slug, slug));
}

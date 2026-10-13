/**
 * `Blog/wren` (designs/2026-10-13-blog-box.md): Write's Blog box. `save` commits the post's
 * Markdown file to the lander repo (a draft builds in dev only; published, the push deploys it
 * within minutes) and keeps its row. `audience` says who the email would reach; `email` reads
 * the live post's issue (/blog/<slug>.json) and hands it to `Newsletter`, which sends each
 * address once. Wren's own site only: a client's key is refused.
 */
import * as restate from "@restatedev/restate-sdk";
import { byOf } from "@wren/core/ask";
import { issueAudience, issueSends, mayMarket } from "@wren/core/marketing";
import { exclusiveHandler, NO_INPUT, PORTAL_FIELDS, sharedHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import {
  BLOG_DIR,
  type BlogPost,
  blogFile,
  blogProblem,
  blogRow,
  blogRows,
  keepBlogRow,
  type LanderRepo,
  markEmailed,
  slugOf,
} from "../blog.js";

export const BLOG_KEY = "wren";
const TOPIC = "newsletter";
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<unknown>;

const SAVE = z.looseObject({
  /** Absent: a new post, its address made from the title. */
  slug: z.string().optional(),
  title: z.string(),
  description: z.string(),
  body: z.string(),
  publish: z.boolean().describe("Up on the site now; false keeps it a draft"),
  ...PORTAL_FIELDS,
});
const EMAIL = z.looseObject({
  slug: z.string(),
  /** Only this address on our own domain, marked [test]. */
  test: z.string().email().optional(),
  ...PORTAL_FIELDS,
});
const SLUG = z.looseObject({ slug: z.string(), ...PORTAL_FIELDS });

interface Issue {
  slug: string;
  title: string;
  url: string;
  text: string;
  draft: boolean;
}

export interface BlogDeps {
  db: Db;
  /** The lander repo through a token for it (`WREN_LANDER_GITHUB_TOKEN`); null: the box is off. */
  repo: LanderRepo | null;
  /** The site the post goes up on. */
  site: string;
  /** His clock, for the post's date. */
  zone: string;
  fetch?: typeof fetch;
}

/** Today on his clock, YYYY-MM-DD. */
const dayIn = (zone: string, at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" }).format(at);

export function makeBlog(deps: BlogDeps) {
  const { db } = deps;
  const f = deps.fetch ?? fetch;
  const only = (ctx: { key: string }) => {
    if (ctx.key !== BLOG_KEY) throw new restate.TerminalError("the blog is Wren's own site only");
  };
  const issueOf = async (slug: string): Promise<Issue | null> => {
    const res = await f(`${deps.site}/blog/${encodeURIComponent(slug)}.json`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`the site answered HTTP ${res.status} for ${slug}`);
    return (await res.json()) as Issue;
  };

  return restate.object({
    name: "Blog",
    handlers: {
      /** Posts, newest first, with whether each is live and mailed. */
      posts: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => {
        only(ctx);
        const rows = await ctx.run("posts", () => blogRows(db));
        return { on: deps.repo !== null, site: deps.site, posts: rows };
      }),
      /** Commit the post to the lander: a draft, or up on the site with today's date. */
      save: exclusiveHandler(
        { input: SAVE, effect: "posts" },
        async (
          ctx: restate.ObjectContext,
          req: {
            slug?: string;
            title: string;
            description: string;
            body: string;
            publish: boolean;
            viewer?: unknown;
          },
        ) => {
          only(ctx);
          const repo = deps.repo;
          if (!repo) throw new restate.TerminalError("the blog needs WREN_LANDER_GITHUB_TOKEN");
          const now = new Date(await ctx.date.now());
          const slug = req.slug?.trim() || slugOf(req.title);
          const had = await ctx.run("row", () => blogRow(db, slug));
          // A new post's address must be free; an old one keeps its first day once published.
          if (!req.slug && had) throw new restate.TerminalError(`/blog/${slug} already exists`);
          const post: BlogPost = {
            slug,
            title: req.title.trim(),
            description: req.description.trim(),
            body: req.body,
            date: had?.publishedAt && req.publish ? had.date : dayIn(deps.zone, now),
            draft: !req.publish,
          };
          const why = blogProblem(post);
          if (why) throw new restate.TerminalError(`Can't save: ${why}`);
          const by = byOf(req);
          const commit = await ctx.run("commit", () =>
            repo.write(
              `${BLOG_DIR}/${slug}.md`,
              blogFile(post),
              `Blog: ${req.publish ? "publish" : "draft"} ${slug} (from Write, ${by})`,
            ),
          );
          const row = await ctx.run("keep", () => keepBlogRow(db, post, { commit, by, now }));
          return { post: row, url: `${deps.site}/blog/${slug}` };
        },
      ),
      /** Whether the post is live yet, and who its email would reach. */
      audience: sharedHandler(
        { input: SLUG },
        async (ctx: restate.ObjectSharedContext, req: { slug: string }) => {
          only(ctx);
          return ctx.run("audience", async () => {
            const issue = await issueOf(req.slug);
            const tally: Record<string, number> = {};
            for (const c of await issueAudience(db, TOPIC)) {
              const v = await mayMarket(db, { channel: "email", address: c.address, topic: TOPIC });
              const k = v.send ? "gets it" : v.why;
              tally[k] = (tally[k] ?? 0) + 1;
            }
            return {
              live: issue !== null && !issue.draft,
              tally,
              sent: await issueSends(db, `${TOPIC}:${req.slug}`),
            };
          });
        },
      ),
      /** Mail the live post to everyone confirmed, once each; `test` sends one to our domain. */
      email: exclusiveHandler(
        { input: EMAIL, effect: "sends" },
        async (ctx: restate.ObjectContext, req: { slug: string; test?: string }) => {
          only(ctx);
          const issue = await ctx.run("issue", () => issueOf(req.slug));
          if (!issue || issue.draft)
            throw new restate.TerminalError(
              "The post isn't live yet. It goes up a few minutes after Publish.",
            );
          ctx.genericSend({
            service: "Newsletter",
            method: "send",
            key: `${TOPIC}:${issue.slug}`,
            parameter: {
              topic: TOPIC,
              slug: issue.slug,
              subject: issue.title,
              text: issue.text,
              url: issue.url,
              ...(req.test ? { test: req.test } : {}),
            },
            inputSerde: JSON_SERDE,
          });
          if (!req.test) await ctx.run("emailed", () => markEmailed(db, issue.slug, new Date()));
          return { sending: true, test: req.test ?? null };
        },
      ),
    },
  });
}

export type Blog = ReturnType<typeof makeBlog>;

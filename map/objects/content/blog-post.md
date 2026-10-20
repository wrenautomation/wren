---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-13 @ 7b4e45de
entity: packages/content/src/schema.ts
---

# blog post

A post on wrenautomation.com/blog written in Write's Blog box: the `blog_posts` row, and the lander Markdown file it commits.

## Why this shape

The lander's Markdown file is the post, so the site, its RSS and the newsletter's `/blog/<slug>.json` all read one source (designs/2026-10-11-newsletter.md). Wren commits that file through GitHub's contents API with a token for the lander repo only (`WREN_LANDER_GITHUB_TOKEN`); a push to main deploys it. The row is what Write lists and Plan's `newsletter` goal counts (`published_at`, first time up; a draft clears it). `emailed_at` is set when `Blog.email` hands the live issue to `Newsletter` (designs/2026-10-13-blog-box.md). `from_ref` (migration 0257, `video:<id>`) says which long video it was written from, so Pieces nests it there; blog posts have no idea row to carry a `ref`, so this one column is the exception to "no parent columns" (designs/2026-10-14-content-types.md).

## Shape

- `blog_posts`: `slug` key, title, description, body, date, draft, published_at, emailed_at, commit_sha, from_ref (`packages/content/src/schema.ts`)
- `slugOf`, `blogFile`, `blogProblem`, `keepBlogRow` (`packages/content/src/blog.ts`). The GitHub contents helper (`githubRepo`, `GithubFiles`: read, write, lastCommit) is core's `packages/core/src/github.ts`; the shape's git mirror uses it too ([[platform/shape]])
- `Blog/wren`: posts, save (`from`: absent keeps `from_ref`, null clears it), audience, email (`packages/content/src/restate/blog.ts`)

Citations: `packages/content/src/blog.ts:1`, `packages/core/src/github.ts:17`, `packages/content/src/restate/blog.ts:1`

## Connected to

- **joins:** the `Newsletter` object (channel-email), the cadence record (`packages/content/src/analytics/records.ts`)
- **looks-like-but-is-not:** [[content/draft]] (a platform post; a blog post has no platform)

## If you change this

- **Hits:** the lander's blog schema (`lander/src/content.config.ts`) must accept what `blogFile` writes
- **Does not hit:** content_drafts, the scheduler

## Surfaces

| Surface | Role |
|---|---|
| Write → Blog post (`apps/portal/web/src/modules/marketing/blog-box.tsx`) | writes, emails; its From pick (recent long-video pieces, or Write's `?from=`) sets `from_ref` |
| Marketing → Pieces (`packages/content/src/pieces.ts`) | reads; nests the post under its video |
| Plan's Blog posts goal | reads |

## See

- Source: `packages/content/src/blog.ts`

---
type: process
status: verified
verified: 2026-09-30 @ 99fd3f6
consumes: ["[[search/keyword]]"]
produces: ["[[search/keyword]]", "[[search/proposal]]", "[[ledger/run]]"]
---

# search-loop

Search Console and the answer engines become keyword numbers, and those become proposed site edits.

## Input → Movement → Output

The Search Console property and the site's origin (`WREN_SEARCH_SITE`, `WREN_SEARCH_ORIGIN`). Daily, `SearchWatch/default` reads the last 7 days of queries and inspects each sitemap page; on Monday it sends `SearchWeek.run` once, which grows keywords, asks Google and Perplexity on the Mac's desk, and has the model propose edits. A person ships proposals with `wren search pr`.

## Why this shape

Search Console has no webhook and reports days late, so it is polled and re-read. The engines refuse the box's IP, so they run on the desk, in their own service: a sleeping Mac delays the week, never the daily read (`restate/watch.ts:63`, `:114`).

## Steps

1. Daily: `syncSearch` (`packages/channel-search/src/sync.ts:47`) in a `runs` row; a page entering or leaving the index is one notice.
2. Monday: `discoverKeywords` (`keywords.ts:69`) and `fanOut` (`keywords.ts:121`).
3. `ask` each due keyword per engine (`answers.ts:45`), `recordAnswer` (`answers.ts:100`); three failures in a row stop that engine for the week.
4. `brief` (`brief.ts:37`) + `siteText` (`site.ts:16`) → `propose` (`propose.ts:80`); counts notice.
5. By hand: `wren search pr` (`apps/cli/src/search.ts:282`): worktree off `origin/main`, apply single matches, `npm run check`, push, `gh pr create`.

## Surfaces

| Surface | Role |
|---|---|
| `wren search watch start/stop/status/sync/week` | the loop |
| `wren search pr` | ships proposals as a lander PR |

## See

- Objects: [[search/keyword]], [[search/proposal]]
- Design: `designs/2026-09-30-search-loop.md`

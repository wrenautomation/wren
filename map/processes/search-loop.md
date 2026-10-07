---
type: process
status: verified
verified: 2026-10-07 @ 5f8d570
consumes: ["[[search/keyword]]"]
produces: ["[[search/keyword]]", "[[search/proposal]]", "[[ledger/run]]"]
---

# search-loop

Search Console and the answer engines become keyword numbers; a person's `/search-week` turns them into small site edits.

## Input → Movement → Output

The Search Console property and the site's origin (`WREN_SEARCH_SITE`, `WREN_SEARCH_ORIGIN`). Daily, `SearchWatch/default` reads the last 7 days of queries and inspects each sitemap page; on Monday it sends `SearchWeek.run` once, which grows keywords, asks Google and Perplexity on the Mac's desk, and notifies "brief ready, run `/search-week`". The skill (`.claude/skills/search-week`) reads the brief and the lander source, drafts word swaps, gates them with `wren search propose`, shows William each, and ships with `wren search pr`.

Per client: `SearchWatch/<client>/daily` reads the client's property (`accounts.search_console`) into its own database, Search Console only: no site days, heatmaps, experiments or week. It stops when the client is gone, the demo, uninstalled or unconnected (`clientSearch`, `restate/watch.ts:122`).

## Why this shape

Search Console has no webhook and reports days late, so it is polled and re-read. The engines refuse the box's IP, so they run on the desk, in their own service: a sleeping Mac delays the week, never the daily read (`restate/watch.ts:63`, `:114`).

## Steps

1. Daily: `syncSearch` (`packages/channel-search/src/sync.ts:47`) in a `runs` row; a page entering or leaving the index is one notice.
2. Monday: `discoverKeywords` (`keywords.ts:69`) and `fanOut` (`keywords.ts:121`).
3. `ask` each due keyword per engine (`answers.ts:45`), `recordAnswer` (`answers.ts:100`); three failures in a row stop that engine for the week.
4. Counts notice: brief ready.
5. By hand, `/search-week`: `brief` (`brief.ts:41`), drafts gated by `refusal` (`propose.ts:53`, at most 6 words changed) and stored by `storeProposals` (`propose.ts:78`) via `wren search propose <file>` (`apps/cli/src/search.ts:223`).
6. `wren search pr` (`apps/cli/src/search.ts:282`): worktree off `origin/main`, apply single matches, `npm run check`, push, `gh pr create`.

## Surfaces

| Surface | Role |
|---|---|
| `wren search watch start/stop/status/sync/week` | the loop |
| `/search-week` (skill), `wren search brief/propose` | the copy step, by hand |
| `wren search pr` | ships proposals as a lander PR |

## See

- Objects: [[search/keyword]], [[search/proposal]]
- Design: `designs/2026-09-30-search-loop.md`

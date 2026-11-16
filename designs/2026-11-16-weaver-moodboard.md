# Weaver run as a moodboard (2026-11-16, WA-1405)

William, 11-16: "more images, text is crucial text, and statistics (dont shy away from showing statistics but do shy away from showing big blocks of text OVER images)". "references are the most important thing. not necessarily the claims". Weaver's goal: "a graph like almost moodboard of any type of content … holistic sources being in the moodboard is important". Builds on `2026-11-05-research-web.md` (the graph) and WA-1404 (content's read-list gallery).

## Target

A run opens on its sources as pictures. The agent's picks are large and ranked. Every page the run read sits under them as a poster wall, sorted by score. Patterns are groups of sources with one number each, not paragraphs. The graph tab draws the same sources as posters around the searches that found them. Text is the question, the pattern lines, and the agent's why on an opened source.

## Before (11-16 shots, scratchpad `wa1405/before/`)

- References: tiles with no poster draw a gray block; text tiles with no picture. A two-line explainer of "10x their usual views" sits above the grid.
- Graph: `graph.ts` `skey` keyed every non-YouTube page by host. On run 01M7H8QTX5FTBCJCZJGKDXE09J that made 176 x.com pages from 142 channels one source, "x.com", with one picture. Page nodes already carry each page's `og`; the source picture came from its most-kept page only.
- Run meta joins facts with middle dots (tell AI-18, set `ui-design-tells`).
- Explorer › Weaver: the run preview is the graph card plus a line of facts; the root pane is one link on white.

## Precedent

PT-51 (new): a channel is a header with an Info table (started, modified, length, followers) and a view switch (Grid, Table), then a grid of blocks. A block is its picture, caption under it. An opened block is the picture left, title, description, an Info table and its connections right. Are.na (record `product-arena`). Shots: `image-fa713b178f74` (grid), `image-fe3afdde2153` (link block), `image-3e7ec43a02af` (image block).

Also: PT-6 (YouTube grid with sort chips) for the poster wall. PT lines live in Canon set `ui-design-patterns`.

## What each surface shows

### Run header (all tabs)

`RunHead` sits above the tab switch, so every tab shows it.

- The question, whole, and the agent's note.
- Two columns of label and value (the shared `Facts` part), tabular figures: Picks, Pages read, Searches, Status ("next: round N step" or "stopped"), Spend, Started. No dotted meta string.
- Spend is a `<details>`: the total, and on tap the rows (`exa search 2 $0.01`). A tap works at 390; a hover does not.

### References tab: the board

Data: picks are `brief.readList`; every other read page is `brief.unpicked` (`PageSignals`: metrics, score, followers per view). serve.ts types both. Only some unpicked pages have a `multiple` (14 of 165 on the 11-16 run); the rest sort by views per follower, then kept findings, the engine's own order (`byScore`).

1. **Picks.** Content's WA-1404 gallery (`apps/portal/web/src/modules/canon/gallery.tsx` `Tile`, `GALLERY`; `post-detail.tsx` `PostDetail`): large posters, rank badge, the multiple as the stat. Unchanged by this pass.
2. **Patterns.** One block per pattern: the line whole, then "Seen in N pages" and how many are picks, then a 56 px square thumbnail per page (rank badge on a pick). A pattern's pages are the pages its findings sit on. The count is evidence, not truth: it says where the agent saw it, not how many picks it holds for. A thumbnail opens `PostDetail`.
3. **Everything else it read.** Every unpicked page as a dense `Tile` (`GALLERY_DENSE`: 3 across at 390, 150 px columns from 720 px of main, 6 across at 1280): the frame, the multiple, one count, the handle. Sort: Score (default, `byScore`), Likes, Newest (`Seg`). The first 60, then "Show all N". A tile with no picture shows its site mark and title on a tint.
4. An opened non-pick shows `PageWhy` (what it gave, how it ranked) in place of the pick's why.
5. The "10x their usual views" explainer leaves the page. The stat's tip says it once.

### Graph tab

Same web layout (`web.ts`) and the same tiers (`marks.tsx` `tierOf`): the top 12 sources with findings are cards, the rest chips. Changes:

- A social page keys its source by author: `so:<host>:<channel>`, as YouTube's `yt:` does. An X run now shows one source per creator, not one "x.com".
- A source's picture is the poster of its best page: pick rank, then score, then kept findings. A creator's source links to their profile.

### Talk tab ("Back and forth")

No change but the header.

### Explorer › Weaver

`apps/portal/web/src/modules/research/explorer.tsx` `WeaverPreview`. Both previews load the run's view once (`useCall` key `research:view:<run>`, shared with the whole view) and read `boardPages`.

- Run preview: the top 6 picks as square thumbnails with rank badges ("Top 6 of 11 picks"), the facts, "Open the whole run". No picks: the 6 best-scored pages. The graph card leaves the preview.
- Page preview: its poster at the top, then views, likes and the multiple, then the links.

## Pattern extraction: options

The 11-16 run kept 48 findings on 12 pages. Most are frame-log trivia ("The video runs 43 seconds"). Its 5 patterns are good, but each is a sentence the agent writes over those findings. The board needs a group of sources and a number.

| | A. Findings, then patterns (now) | B. Traits per source | C. Agent groups | D. Embedding clusters | E. Computed splits |
|---|---|---|---|---|---|
| How | Read writes sentence findings with quotes; the agent writes patterns over findings | Read fills a fixed trait set per content type (video: cuts a minute, words a second, captions, voice, opening shot); a pattern is a trait split, picks against the rest | The agent tags sources into named groups with a why, like Are.na channels | Embed posters and transcripts, cluster, the agent names each cluster | Splits on fields the view holds now: length, date, multiple, likes, speaker. "9 of 11 picks under 60 s; 41% of the rest" |
| Numbers | The engine counts sources, speakers, evidence, echo and unchecked per pattern; the claim's share of picks is not computed | Computed per trait | None | Cluster sizes only | Computed |
| Checkable | Quote gate per finding | Each trait is a typed value from a code → model tool; the split is arithmetic | The why only | No | Arithmetic only |
| Text sources | Yes | Needs a trait set per type (article: length, data tables, first-hand) | Yes | Yes | Length and date only |
| Cost | A model call per finding | One call per page. `open --see` runs only on a video the agent names; reel and TikTok skims already write a `## Visual cues` line (cuts a minute, words a second) | Agent turns | Embedding per page | None: no engine change |
| Weakness | Trivia findings; numbers buried in sentences | A schema per type to keep up | Taste with no proof | Unstable across runs; no reason | Few fields; says nothing about the content itself |

Priorities, in order: the group points at sources (references first), it carries a number, the step is checkable (agent drives, code is tools), then cost.

Recommendation: E now, then B for the traits the record does not hold (start from the skims' cue line). C for a type with no trait set. Findings stay for claims a trait cannot hold (a quote from an article). This pass ships A as is: a pattern shows its pages and "Seen in N pages". B and E wait on William's pick.

## State table: the board (References tab)

| State | Shows | Enters on | Next | Motion out |
|---|---|---|---|---|
| Loading | `Ghosts` gallery skeleton | open | typical, failed | crossfade 150 ms |
| Old serve | "This weaver serve sends no read list. Run weaver 0.79.0 or later." | `readList` absent | — | — |
| No picks yet (live run) | Patterns and the wall; "The agent has not picked pages yet." | `readList` empty | typical on the next live event | instant (data refresh) |
| Nothing read | "No references yet"; the default tab is Graph | 0 pages | loading | instant |
| Typical | Picks, patterns, wall | data | detail open, sort | — |
| Many (176+) | Wall shows 60, then "Show all 176" | > 60 unpicked | all shown | instant: one press, rare |
| Page has no multiple | Tile shows its count with no stat; sorts after scored pages | score absent | — | — |
| No poster | Tint tile with site mark and title | `image` null | — | — |
| Poster fails to load | Same as no poster | img error | — | — |
| Sort changed | Same tiles, new order | Seg | sort again | instant: tens a day, a key-like control (MV-1) |
| Live page arrives | It joins the wall in its sort place; sort, "Show all" and an open detail stay | serve event | — | fade 150 ms |
| Detail open | `PostDetail` over the board | tile press | closed | content's sheet motion |
| Load failed | `LoadFailed` with Retry | serve error | loading | instant |
| 390 | Picks 2 across, thumbnails wrap, wall 3 across | width | — | — |
| 1280 | Picks about 5 across, patterns in two columns, wall 6 across | width | — | — |

Graph tab: no new states. A source with no poster shows its site mark, as today. Explorer preview: loading (6 skeleton squares), no picks (the 6 best-scored pages), failed (`LoadFailed`).

## Motion

| Transition | Seen | Purpose | Motion |
|---|---|---|---|
| Sort change | tens a day | spatial | instant (MV-1: frequent); MO-4 exception, named here |
| Poster loads | every open | change that would jar | opacity 150 ms |
| Thumbnail hover | often | feedback | the link dims to 85%, 150 ms; the picture stays still |
| New tile or section | each load | state change | fade 150 ms |

## Non-goals

- Pattern extraction (B or E): an engine change after William's pick.
- Search facets on the wall: follows have no facet and a page can come from several searches. Revisit when a run asks for it.
- New graph tiers (poster dots): the 11-08 log rejected dots, since a dot carries no name.
- A free canvas of poster islands (see Log).

## Risks

- 60 to 176 pictures on one page: posters load lazily; "Show all" stays one press.
- X thumbnails (`pbs.twimg.com`) may expire. A failed poster falls back to the site mark; `weaver images <run>` refetches them.
- Patterns count only pages with kept findings: the blocks are thin until B or E.

## Files

- `apps/portal/web/src/modules/research/board.tsx` (new): `boardPages`, `postOf`, `Patterns`, `Wall`, `Thumb`.
- `page.tsx`: `RunHead` above the tabs, `References`, `PageWhy`.
- `serve.ts`: `PageSignals`, `BriefPattern`, `unpicked`, `patterns`.
- `graph.ts`: `skey` by author for social sites; source poster by pick rank.
- `explorer.tsx`: run mosaic, page poster and stats.
- Fixtures: `mocks/data/research-board.ts` (`BOARD_VIEW`, 180 pages).

## Tests

- `graph.test.ts`: one source per author on a social site; a source's poster is its top pick's.
- Stories: Research › Board (worst case), Explorer › Weaver › Run and RunBoard.

## Done

- The three tabs and the Explorer preview, shot at 390 and 1280, both looks, each state row.
- A worst-case story: 180 synthetic pages, posters drawn inline (as `mocks/data/outliers.ts`), 5 patterns, 20 pages with no poster.
- Tells and box-fit counts in the hand-over; fresh-eye review.

## Log

- 11-16: board = References tab (sections, PT-51) and Graph tab (posters on the web layout). A free canvas of poster islands was the third direction; dropped: weak at 390 and stats hard to scan. Pattern shelves in place of a pattern tab: one place to look.
- 2026-11-16: goldfish review: 30 findings (critic 15, reader 15), 22 applied, 8 rejected or folded into the scope cut (facets, graph tiers, Info table, spend hover). Fixed: social sources keyed by author; non-picks read from `brief.unpicked`; pattern count is "Seen in N pages"; option E added; option A and B rows corrected; Non-goals, Risks, Files, Tests. Open: William picks B or E for pattern extraction.
- 2026-11-16: the wall uses content's dense `Tile` (wren 0158ef4eb): the first 60 at 390 went from about 16,000 px to 4,800 px.
- 2026-11-16 (WA-1410): William: "remove the big text. E and B is fine." The explorer preview drops "The page as read". E is built: "What sets the picks apart" (`splits.ts`, MIN_KNOWN 3, MIN_GAP 0.2). B is built as countable traits read from the stored page text at view time (weaver 0.80.0 `traitsOf`): a video gets cuts a minute, words a second, words a cut, picture changes, words that point at the screen and on-screen lines (on-screen lines are absent on a skim). A page gets words and tables. View time, not a stored field, so no backfill: 165 of 165 video pages on 01M7H8QTX5FTBCJCZJGKDXE09J already hold the cues line. Splits cut a measured trait at the run's median, and a rare count at 0. Model traits (opening shot, voice) wait: each costs a model call per page.

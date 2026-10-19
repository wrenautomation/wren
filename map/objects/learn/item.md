---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-10-19 @ b5ed2495
entity: packages/learn/src/schema.ts:152
---

# item (Learn)

One thing to learn from (`learn.items`), in one workspace (`client`: a client's id, or `wren`): a link someone saved (portal box, phone Shortcut, `wren learn add`) or a post from a source he follows (`learn.sources`). It keeps the transcript whole, a 0-10 score on how much its workspace can use it (Wren's: against what Wren builds and runs, `WREN_FOCUS` in `score.ts`, and its SOPs; a client's: its SOPs alone), and which SOPs it was added to (`learn.sop_sources`).

## Why this shape

Saved and followed items are one table, so a link saved after its feed brought it keeps its read and score. The score sets the verdict: 7 and up shows (Worth reading), 4 to 6 holds, the rest drops. Following a source marks its back catalog done: only what comes next is read. The back catalog is read on ask, a few reels a pass (`wren learn catalog <profile>`: a profile address or an Instagram handle, bare or `@name`; or `learn add` with a profile): no cursor is kept, each pass walks newest first and skips posts already items, so the next pass reaches older ones. A YouTube video up to 40 minutes reads on the worker, by URL through the gateway's Gemini keys (`youtubeByUrl`). Other videos, reels, longer ones and failed worker reads need yt-dlp and a home IP, and an episode's audio needs ffmpeg, so they wait for the Mac (`needs_mac`). A client's items score on its own models allowance, against its own SOP names; its SOP asks land in its own Notes. Was the Monitor's radar (`watch.feeds`, `watch.items`) until 2026-10-07.

## Shape

- `sources` (`schema.ts:92`): `client`, unique (client, url), `page` it was found from, `kind`, `tell` (every, top = score 8+, digest), `fetched_at` (feeds hourly; instagram, x and tiktok creators every 6 hours, `creators.ts`: Instagram and X on the Monitor's pass through autobrowse on the desk, TikTok by yt-dlp in `wren learn read`), `failure`, `stopped_at`
- Finding a source by name or topic (Learn → Sources, Marketing → Feed, the same list): `ReachDesk.findCreators` (`packages/outreach/src/creator-search.ts`), one finder a site over autobrowse (YouTube channel search, Reddit subreddit search signed out, LinkedIn people as the comments account plus company pages by Exa, X handle then recent-post authors, Instagram the accounts behind Google's results read by business discovery, TikTok by Exa; reads go as `linkedin@wren`/`x@wren` when no comments account is set; a used daily cap says when it resets in `failed`), each hit with its `follow` address (a feed for Learn; a LinkedIn page goes to the comments' `pages` via `ReachDesk.paste`) and `followed` marked from `sources`. Wren's workspace only. Marketing → Feed's Following is `learn/browse` over the followed sources, newest first (Reply = paste, Use as idea = Write `?idea=`, Mute = unfollow)
- `items` (`schema.ts:152`): `client`, unique (client, cleaned url), optional FK to its source; `kind` (article, video, reel, episode), `text`, `transcript`, `file` (its name under an SOP's `sources/`), `needs_mac`, `read_at`, `read_failure`, `score`, `verdict`, `changes`, `saved_at`/`saved_via`, `told_at`, `done_at`; a generated `search` tsvector (GIN); `searchItems` reads it with a snippet and, given an embedder, by meaning; `findItems` (`items.ts`, route `find`) is ⌘K as you type, each word a prefix, titles first; `embedding` real[] (256, unit length, `embed.ts`), filled on the Monitor's pass
- `sop_sources`: one row an item (or a note's words: `note_id`, `client`, `title`, `text`, migration 0211) and SOP; `asked` → `added` (or `failed`), `points` once extracted. A note ask comes from Notes' Add to an SOP ([[platform/notes]])
- Back catalog: `readCatalog` (`catalog.ts:54`) queues the next `want` reels with `needs_mac` and takes back items a follow kept as seen (`FOLLOWED_BEFORE`, `creators.ts:25`), and calls `onPage` after each page; pages from `instagramPage` (`creators.ts:161`, autobrowse `meta GET /instagram/{username}` by Graph cursor) and `tiktokPage` (`:259`, yt-dlp offsets); X cannot be paged. `profileOf` (`:116`) is what the catalog takes: a profile address (`creatorOf`, `:82`, never a post URL) or a bare or `@` handle, read as Instagram's. `readQueued` (`catalog.ts:223`) then reads and scores the queued reels one at a time (the CLI prints a line each on stderr), keeps a scoring failure as the reel's `why` and goes on, and stops after 3 failed reads in a row (the rest wait for `wren learn read`); `catalogSummary` totals the pass. Each outside call is bounded: the desk page by 120 s (`PAGE_MS`), yt-dlp and ffmpeg by 300 s (`runFor`, `research/src/sops/index.ts`), each Gemini call by 180 s and one ask by 360 s (`askGemini`). A 24-reel pass takes about half an hour, one reel after another
- `stats`, `stats_at`: a followed post's likes, comments and views, refreshed each creator pass; a reel or video gets a [[learn/breakdown]] after its score
- Pictures (`pictures.ts`): `keepPictures` on the Monitor's pass copies each `thumbnail_url` and source `avatar_url` still at its host into the media bucket ([[content/media]]) and repoints the rows at `s3://…`; a 4xx host drops the address. The portal's `/media` serves a kept one from the edge a year, asking `LearnPictures/sign` once on a miss, so opening Learn reads no platform. Episode audio stays at its host. Search embeds a query once per warm instance (`keepQueries`, `embed.ts`)
- `digests`: one row a day, so the 09:00 digest goes once
- `alert_picks`, `readers`, `alerts`, `settings` (`alerts.ts`): per person picks, the bell and Today, held alerts past 5 an hour, the digest mail flag (off by default)
- Views `learn.item_records`, `learn.saved_records`, `learn.source_records`: Wren's own only

## Connected to

- **joins:** [[platform/spine]] (workflow `learn`: `feeds.items`/`saved.item` → `read.item` → `score.item` → `out.to_read`), [[watch/mail]] (the Monitor's pass pulls feeds and sends Learn's alerts)
- **joins:** [[platform/decide]] (`learn_worth`: a star, pin, save or SOP add is worth, an archive alone skip; Wren's cards carry the model's pick)
- **looks-like-but-is-not:** the Library's SOPs (`library.sop`, pushed playbook texts); Reddit discovery (finds places to talk, not to learn)

## If you change this

- **Hits:** the score prompt and verdict cut (`verdictOf`), `wren learn rescore`, the Learn app, LearnConsole, `wren learn` (`catalog`, `add`), the catalog's reader (`apps/cli/src/learn.ts:219`), the SOP folders under `WREN_SOPS_DIR`
- **Does not hit:** mail triage

## Surfaces

| Surface | Role |
|---|---|
| `Watch/all` on the box, each source hourly | writes items, emits to Spine, sends alerts and the digest, writes each person's bell alerts |
| Spine `learn.read`, `learn.score` (Lambda) | reads articles and YouTube videos, marks other videos for the Mac, scores |
| `wren learn read` on the Mac | reads videos, reels and episode audio for every workspace, scores, writes Wren's SOP asks into folders |
| LearnConsole (Learn app, `/learn/add?url=`) | writes |
| `wren learn catalog` on the Mac | queues and reads a creator's older reels |
| Learn app: Wren's team in Wren's own; a client's logins in theirs, by grants on app `learn` | reads |
| The portal bell and Learn Today, per person | reads, marks seen, sets picks |

## See

- Source: `packages/learn/src/`
- Design: `designs/2026-10-07-learn.md`

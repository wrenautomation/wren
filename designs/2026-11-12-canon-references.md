# Canon references in the portal (2026-11-12, WA-1341)

William wants to check the reference videos and see how each one maps to us, before the work
that recreates references. This doc covers one view: video references (reels and long form). The
whole graph view (WA-1281) builds on the same index later.

## Goal

One page, Canon › References. Each video reference shows:

- the video playing in place, with a poster
- title, creator, platform, length
- provider: William, Weaver or an agent
- William's notes, whole
- tags
- the rule lines it backs, by id (VL-4), with the line's text

Filters: tag, provider (his own first by default), platform, kind (reel or video), and a search box.

## Facts (checked 11-12, Canon at 53f99dab)

- Canon is a git repo of markdown records (`canon/sources/*.md`). Prod has no Canon tables.
- Video references: 569 reels and 250 videos (819). Providers: human 89, weaver 182, agent 548.
- Media: weaver's read keeps each downloaded video in the media bucket under
  `cache/<platform>/<id>.mp4` (`s3MediaStore`, read/src/video/s3-store.ts). 394 reels are there
  (1.17 GB, about 3 MB each). 258 of Canon's 592 Instagram videos are stored; 334 are not. No
  poster file is stored. The record's `image:` URL expires (`oe=`). The worker may sign only
  `media/*` (deploy/terraform/media.tf:52).
- Rule sets list sources in `cites:`. A line cites by position: `[7]` is the 7th entry.
  `linesOf` (knowledge provenance.ts:50) already maps a rule set's lines to their cited records,
  also through findings to their sources.
- The index (`knowledge` record-index.ts) holds records and record-to-record cites
  (`knowledge_records`, `knowledge_cites`, `knowledge_meta`). Its tables are unqualified, and a
  `SCHEMA` bump drops and rebuilds them.
- William's notes: 86 records carry a `note: {text, by, at}`. `note` is bookkeeping: an edit never
  makes a citing rule stale (write.ts `BOOKKEEPING`). States as of now:
  - 44 short notes he typed ("insane editing effects", "editing style").
  - About 30 notes are chat messages cut at about 250 chars, mid-word. Many are mostly
    instructions to an agent, with a line about the link inside.
  - The full messages: `~/.claude/history.jsonl` and the session transcripts hold 52 of them.
  - 10 notes are agent words ("in his Learn folder "Design refs"").

## D1: how prod gets the index

The knowledge design (2026-11-09) chose git files as the truth with a Postgres index. Open: what
runs the sync for prod.

William 11-12: "why does it have to be a sync? ... can there not be one source of truth?" There is one:
git. The index holds no fact git lacks, nothing else writes it, and a drop rebuilds it. The portal
needs it because a page that lists, filters and walks cites cannot read 10.6k files per request.

| | Truth | Trigger | Against |
|---|---|---|---|
| A | git | Canon's post-commit hook on the Mac runs the sync | stops when the Mac sleeps; only repos on this Mac |
| B | Postgres | none | loses git history, diffs and the knowledge engine |
| **C** | **git** | **push → GitHub webhook → box fetches a bare clone, diff sync** | **git in the box image; a GitHub token on the box** |
| D | git | CI writes a JSON snapshot to S3; the portal reads it | no SQL or cite walk; a second read path |

Pick C (William, 11-12: "sure go with C"). No Mac in the path; a client repo is one more key. Scale:
a diff sync reads only the files changed since `knowledge_meta.head`, so a push costs O(changed
files). The index trails git by seconds; each pass goes to `main`'s tip, so a missed one heals on
the next. The box, not Lambda: the clone stays on disk (a fetch moves new objects only) and the
writes stay beside Postgres.

- `CanonIndexSync/<repo>` (packages/research `canon-index.ts`), box lane. `sync` per push, `start`
  for the hourly backstop, `rebuild` rereads every file (after a force push). Exclusive per repo.
- The phone Worker's `/webhooks/github` checks `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`), takes
  a push to `main` of a repo in `CANON_REPOS`, sends `sync` keyed by the delivery id. Door down:
  held and replayed (GitHub never redelivers on its own).
- The box keeps a bare clone in `/var/lib/wren-pg/canon` (mounted at `/var/lib/wren-canon`).
  Fetch over HTTPS with `WREN_SHAPES_GITHUB_TOKEN` (fine-grained, contents on Canon; the shape
  mirror's, already in env-2), passed as env-only git config. The org turns deploy keys off, and a
  second token would add a secret for no new reach: the box process holds this one already. Image
  `wren-box-node:22-git-1`: node:22-slim plus git, built on the box by `box-worker.sh`.
- Each pass first runs `ensureCanonIndex` as main: schema `canon`, login `canon_index` (password
  derived from main's, as client logins are; `search_path=canon`), `USAGE, CREATE` on `canon` only,
  and default privileges so main reads every table `canon_index` makes, a rebuild's too. No
  migration: the role's password cannot sit in SQL.
- Only `CanonIndexSync` writes, so one pinned `knowledge` version owns the tables.
- `wren canon sync [--full]` and `wren canon start` ask the box; the Mac holds no index rights.
- The portal reads `canon.knowledge_*` by name (a `pgSchema("canon")` copy of the three tables).

## D2: media

| | How | For | Against |
|---|---|---|---|
| **A** | **Stored reels: the existing `cache/instagram/<id>.mp4`, signed. Missing reels: download through the same store. YouTube: its embed and `i.ytimg.com` poster** | **258 play on day one; no new field or record write; files outlive a deleted post; the kit's `Video` shows beat marks** | **334 to download (about 1 GB)** |
| B | Instagram's embed (`instagram.com/reel/<id>/embed`) for every reel | no storage, no spend | gone when the post goes; Instagram's frame; no beat marks |
| C | Posters only | small | no playback, and playback is the point |

Pick A, with B as the state for a reel not stored yet or that fails to download.

- Add `cache/*` to the worker's `GetObject` in `worker_media`.
- The key comes from the record id, so records stay as they are.
- Poster: the stored file's first frame (`preload="metadata"`). Never the expiring `image:`.
- The backfill: yt-dlp signed out on the Mac, 1 reel each 20 s, 2 tries each. Stop the run after
  10 failures in a row. A failed reel stays on the embed.
- Cost: about 1 GB more in the bucket, cents a month. The backfill needs William's yes (spend).

## D3: his notes

William 11-12: "make sure my personal notes per link don't get cut off." And: "fix typos and do
super minimal rewrites on my notes for standardization."

- A note is never cut: not in the record, not on screen. No character cap, no ellipsis, no line
  clamp.
- `note` stays one field per record.
- Pass 1, split (the 30 cut notes): from his full message, keep the sentences about this link.
  Each kept sentence must be found verbatim in the message. A link with no sentence of its own
  keeps the whole message. Instructions to an agent about other work drop out.
- Pass 2, typos (every note he wrote): fix spelling, caps and end marks. Keep his words, order
  and meaning. No summary, no new claim. A word diff checks each note: every changed word is a typo
  fix (small edit distance).
- This session does both passes, a one-off. William gets the before and after of each note. The
  raw notes stay in git history.
- The 10 Learn marks stay as they are: they record his own act (a folder, a star).
- No agent writes a note for him. An empty note stays empty.
- From now on a note comes in with the link: `wren source add <link> --from william --note "…"`
  (WA-1342). A second note goes under the first.

## The page

- Module Canon (team only), page References. Later pages: Guides, Rules, the graph (WA-1281).
- A grid of cards: poster, length, title, creator, platform icon, provider chip, his note in full
  (never clamped; a story holds a 600-char note). The list pages by 60, by offset, sorted by saved
  date then id.
- A card opens a sheet:
  - the player: the kit's `Video` for stored reels, with the breakdown beats as marks; the
    Instagram embed for the rest; the YouTube embed for long form
  - his note, tags, provider, saved date, post numbers
  - "Backs": each rule line with its id, its set and its text, linked to the set
  - the hook, CTA and transcript, folded
- Reads: `console/canonReferences` (filters, page) and `console/canonReference` (one). "Backs"
  walks `knowledge_cites` up from the source to the rule sets, then runs `linesOf` on those rows.
- Fields: `platform`, `kind`, `length`, `provider`, `tags`, `saved`.
- Read only in v1. Edits stay in Canon through the CLI.
- States: loading, empty filter, no index on prod yet, a reel on the embed, a long title, a long
  note. The page footer names the indexed commit (`knowledge_meta.head`).

## D4: the Add box (WA-1345)

He pastes a link or drops a file, adds his words, and it lands in Canon like `wren source add
--from william --note`. Facts: the box token can push to Canon. The box image has no yt-dlp or
ffmpeg. Instagram refuses most cloud IPs; every reel so far came down from the Mac.

| | Who files it | For | Against |
|---|---|---|---|
| A | The box: clone, `addSource`, commit, push | lands in about a minute, no Mac | new image (yt-dlp, ffmpeg); Instagram blocks AWS IPs, so reels fail or need a proxy; a second writer to Canon |
| **B** | **The portal stores a request row; the Mac files it with the same CLI, then marks it done** | **one writer and one add path; reels download from a home IP; an agent can tag it and fix typos in his note** | **lands only while the Mac is awake (minutes, not seconds); one new table** |
| C | A GitHub Action in Canon, on `repository_dispatch` | no Mac, no box change | the wren CLI, model keys and AWS keys in Canon's secrets; same IP block as A |

Recommend B. Ranked by: reels must land (A and C fail there), one write path, no new secret. The
row shows on the page as "Filing…" until the index has the record; a failed add shows its error
and a Retry. A file goes to the media bucket first (`canon/<sha32>`, as `source files` does).

## D5: the whole of Canon in the portal (WA-1346)

William: "everything related to canon should be synced and shown in the portal", and "canon is
sort of like an implicit file structure, but also with references, visuals, and many to many
connections". Read only.

- Index: engine 0.75.0 adds `knowledge_files` (every repo file; body null when binary or over
  2 MB). `canonLibraryApi` reads records, cites and files; never the repo.
- Pages: Overview (topics, shared rule sets, direction, conflicts, stale cites), Library (every
  record, filters, search over files), References, and a topic page. Any record or file opens in a
  side panel (`?r=` / `?f=`), so a link never leaves the page.
- A topic page runs in layer order: Skill (what SKILL.md loads, parsed from its `knowledge render`
  lines with `--only`/`--except`) → Procedure → Rule sets → References. Each rule line shows its
  id, its backing (`knowledge audit`: his, agent, unknown, none), its open conflicts and the
  reference posters under it. Own sets open; borrowed sets fold and name their owner. Each
  reference says which lines it backs. Evidence, checks, his notes, conflicts and files sit beside.
- The many-to-many: a set lists the topics that also load it; Overview lists every shared set.

## Non-goals

- Editing notes or tags in the portal: a portal edit is a commit, built later.
- "Used in Vireo": no guide holds a Canon id yet. Add it with the field that links them.
- Non-video sources (web, reddit, arxiv): the same page takes a source type filter later.
- The graph view (WA-1281).

## Risks

- A signed-out download fails on a private or deleted reel. It stays on the embed.
- A `knowledge` release that changes `SCHEMA` rebuilds prod's tables on the next sync, and the
  portal's table copy must match it. Bump wren's pin and the copy together.
- A push GitHub fails to deliver waits for the hourly fetch. The footer shows how fresh the index is.
- A full rebuild reads every file into the box worker (640 MB cap); today about 44 MB of text.
- Copyright: copies are private study material in a private bucket, never published.

## Order

1. Migration, `wren canon sync`, the hook, a first full sync by hand.
2. `cache/*` in the worker policy. The reads and the page, against stories with synthetic records.
3. Notes: both passes, his review, one commit.
4. Backfill of 334 reels (after his yes).

## Decision log

- 2026-11-12: D1 D (Mac hook, scoped role), D2 A (stored reels, YouTube embed), D3 split his
  messages per link. Open for William: the media spend.
- 2026-11-12: William asked for a typo pass on every note: D3 pass 2.
- 2026-11-12: goldfish review: 34 findings, 22 applied, 12 rejected; open: the backfill spend.
  Main changes: reels already stored (D2 rebuilt on the existing store, no `media` field); grants
  survive a rebuild; sync detached, one writer; line ids at read time with `linesOf`; "Used in
  Vireo" cut; the note facts restated (about 30 still cut).
- 2026-11-12: notes done: 76 of 86 rewritten (Canon 6fce9270). 2 had no words of his about the
  link and lost the note; 2 (SEO, LinkedIn) have no full source and stay cut. Learn marks unchanged.
- 2026-11-12: D1 moved from the Mac hook to C (box fetches on push), William: "sure go with C". Built: `CanonIndexSync`, `/webhooks/github`, `wren canon sync`.
- 2026-11-12: References page built and shipped (bcf7926, 0fc5b5e). D4 (Add box) written; open for William: B recommended.
- 2026-11-12: D4 B, William: "make sure this can scale to past just our mac into servers". Built: `canon_add_requests` (skip-locked claims, 3 tries), Add box on References, `wren source drain`, Mac launchd drain; the drain tells live topic `canon-adds`.
- 2026-11-12: D5 built (WA-1346): engine 0.75.0 `knowledge_files`; Canon Overview, Library, topic in layer order, record and file panel. Fresh-eye review: 12 findings, 5 applied, 7 rejected (shell crumb and tab bar, focus ring and worst-case title in the shots, reading measure, poster grid width, thumb labels).
- 2026-11-12: D5 speed on prod (EXPLAIN ANALYZE, server side): search was 4 seq scans at ~160 ms each; engine 0.75.1 adds trigram index `knowledge_records_search` where pg_trgm exists (wren 0394 installs it): 38-47 ms. Home stale cites 110 → 62 ms (narrow rows, hash joins). Rest under 45 ms. Left: a `changed` column in the engine would cut stale to ~30 ms; needs a schema bump and rebuild.

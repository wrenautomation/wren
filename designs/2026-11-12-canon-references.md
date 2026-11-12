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

| | How | For | Against |
|---|---|---|---|
| A | Mac writes with the owner URL | no new code | owner rights for an index job |
| B | Mac posts the diff to an ingress handler | box holds the only DB rights | a full rebuild is about 40 MB: chunks or an S3 hop; a second code path beside `sync` |
| C | Box fetches Canon from GitHub and syncs | no Mac needed; fits many client repos | git in the worker image, a deploy key in SSM |
| **D** | **Canon's post-commit hook runs `wren canon sync` as a role that writes only schema `canon`** | **same code as the local index; fresh on every commit; least rights** | **needs the Mac; one more DB role** |

Pick D. Today only the Mac writes Canon. Canon's hook already reaches prod from the Mac (it pushes
guides). When clients write their own repos, move the sync to the box (C). The tables stay the same.

- One SQL migration: schema `canon`, role `canon_index` (owner, `search_path=canon`), `USAGE` for
  wren, and `ALTER DEFAULT PRIVILEGES FOR ROLE canon_index IN SCHEMA canon GRANT SELECT ON TABLES TO
  wren`. A rebuild that drops and makes the tables again keeps the grant. The password is set out of
  band and goes to SSM (`/wren/canon-index-url`). The hook reads it through `scripts/secrets.mjs run`.
- Only `wren canon sync` writes, so one pinned `knowledge` version owns the tables.
- The hook runs it detached, under a lock file, before its "no guide changed" exit. A commit never
  waits for it. A diff sync is safe to replay, so a missed run heals on the next commit.
- The hook never runs a full rebuild. When `sync` needs one (amend, rebase, `SCHEMA` bump), it stops
  and prints `wren canon sync --full`.
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

## Non-goals

- Editing notes or tags in the portal: a portal edit is a commit, built later.
- "Used in Vireo": no guide holds a Canon id yet. Add it with the field that links them.
- Non-video sources (web, reddit, arxiv): the same page takes a source type filter later.
- The graph view (WA-1281).

## Risks

- A signed-out download fails on a private or deleted reel. It stays on the embed.
- A `knowledge` release that changes `SCHEMA` rebuilds prod's tables on the next sync, and the
  portal's table copy must match it. Bump wren's pin and the copy together.
- The sync runs only when the Mac commits. The footer shows how fresh the index is.
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

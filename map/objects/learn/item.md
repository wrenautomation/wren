---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-10-07 @ learn
entity: packages/learn/src/schema.ts:88
---

# item (Learn)

One thing to learn from (`learn.items`): a link William saved (portal box, phone Shortcut, `wren learn add`) or a post from a source he follows (`learn.sources`). It keeps the transcript whole, a 0-10 score on how much it should change how Wren works, and which SOPs it was added to (`learn.sop_sources`).

## Why this shape

Saved and followed items are one table, so a link saved after its feed brought it keeps its read and score. The score sets the verdict: 7 and up shows (Worth reading), 4 to 6 holds, the rest drops. Following a source marks its back catalog done: only what comes next is read. Videos and reels need yt-dlp, a home IP and the Gemini fleet, so they wait for the Mac (`needs_mac`). Was the Monitor's radar (`watch.feeds`, `watch.items`) until 2026-10-07.

## Shape

- `sources` (`schema.ts:57`): unique url, `page` it was found from, `kind`, `tell` (every, top = score 8+, digest), `fetched_at` (hourly), `failure`, `stopped_at`
- `items` (`schema.ts:88`): unique cleaned url, optional FK to its source; `kind` (article, video, reel, episode), `text`, `transcript`, `file` (its name under an SOP's `sources/`), `needs_mac`, `read_at`, `read_failure`, `score`, `verdict`, `changes`, `saved_at`/`saved_via`, `told_at`, `done_at`; a generated `search` tsvector (GIN)
- `sop_sources`: one row an item and SOP; `asked` → `added` (or `failed`), `points` once extracted
- `digests`: one row a day, so the 09:00 digest goes once
- Views `learn.item_records`, `learn.saved_records`, `learn.source_records`

## Connected to

- **joins:** [[platform/spine]] (workflow `learn`: `feeds.items`/`saved.item` → `read.item` → `score.item` → `out.to_read`), [[watch/mail]] (the Monitor's pass pulls feeds and sends Learn's alerts)
- **looks-like-but-is-not:** the Library's SOPs (`library.sop`, pushed playbook texts); Reddit discovery (finds places to talk, not to learn)

## If you change this

- **Hits:** the score prompt and verdict cut (`verdictOf`), the Learn app, LearnConsole, `wren learn`, the SOP folders under `WREN_SOPS_DIR`
- **Does not hit:** mail triage

## Surfaces

| Surface | Role |
|---|---|
| `Watch/all` on the box, each source hourly | writes items, emits to Spine, sends alerts and the digest |
| Spine `learn.read`, `learn.score` (Lambda) | reads articles, marks videos for the Mac, scores |
| `wren learn read` on the Mac | reads videos and reels, scores, writes SOP asks into folders |
| LearnConsole (Learn app, `/learn/add?url=`) | writes |
| Learn app, admins only | reads |

## See

- Source: `packages/learn/src/`
- Design: `designs/2026-10-07-learn.md`

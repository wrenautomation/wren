---
type: object
cluster: learn
universe: live
status: verified
verified: 2026-11-11
entity: packages/learn/src/schema.ts:171
---

# item (Learn)

One thing to learn from (`learn.items`), in one workspace (`client`: a client's id, or `wren`): a link saved with `wren learn add`, a film from `learn import-films`, a competitor's ad from `learn ads`, or one of our own posted pieces (`draft_id`, learn back). It keeps the transcript whole, its [[learn/breakdown]], and which SOPs it was added to (`learn.sop_sources`).

## Why this shape

Learn is now the breakdown core: read, break down, feed SOPs. The reader half (feeds, follows, back catalog, scores, alerts, digest, embeddings, pictures, the portal app) was cut on 2026-11-04 (WA-1067.2). It comes back as Weaver outputs or the brand voice under Map. A YouTube video, a reel or an episode needs yt-dlp, ffmpeg and a home IP, so it waits for the Mac (`needs_mac`). A client's items break down on its own models allowance (`judges`, `judge.ts`).

## Shape

- `items` (`schema.ts:171`): `client`, unique (client, cleaned url); `kind` (article, video, reel, post, film, episode, ad; a film is always watched, with the scene detectors on), `text`, `transcript`, `file` (its name under an SOP's `sources/`), `needs_mac`, `read_at`, `read_failure`, `saved_at`/`saved_via`, `draft_id` (unique: one of our own pieces, kept out of the standard)
- `ads` (`schema.ts:552`): one row an `ad` item: the Meta Ad Library numbers (`days_running`, `versions`, `platforms`, `format`, `active`) and `raw`, the library record whole. A pull again updates them. Winners (`ads.ts` `isWinner`: active 30+ days, or 3+ versions) get the tags `winning-ad` and `reference`. Design: `designs/2026-11-11-competitor-ads.md`
- `sop_sources`: one row an item and SOP; `asked` → `added` (or `failed`), `points` once extracted. `wren learn to-sop` asks; Wren's only
- `sources`, `score`, `verdict`, `embedding`, `digests`, `alerts` and the views: left in place, unread since the cut; dropped after a lake snapshot

## Connected to

- **joins:** [[learn/breakdown]], [[sop-build]] (`sop learn-back` reads our own pieces on the Mac)
- **looks-like-but-is-not:** the Library's SOPs (`library.sop`, pushed playbook texts)

## If you change this

- **Hits:** `wren learn` (`add`, `read`, `breakdown`, `to-sop`, `ads`), `apps/cli/src/learn-readers.ts`, `apps/cli/src/learn-ads.ts`, starling inbound learn back, Canon under `WREN_CANON_DIR` (source records tagged with the SOP)
- **Does not hit:** mail triage, the portal

## Surfaces

| Surface | Role |
|---|---|
| `wren learn add` | saves, reads, breaks down |
| `wren learn ads` on the Mac | pulls an advertiser's or a keyword's ads (autobrowse `fb-public GET /ads` on the desk), reads each (video through the watch core, images through the eye), breaks it down; `--winners` lists the long runners |
| `wren learn read` on the Mac | reads videos, reels and episode audio, breaks each down, writes Wren's SOP asks into folders |

## See

- Source: `packages/learn/src/`
- Design: `designs/2026-10-07-learn.md`

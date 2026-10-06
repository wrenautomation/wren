---
type: object
cluster: watch
universe: live
status: verified
verified: 2026-10-06 @ fe562df
entity: packages/watch/src/schema.ts:131
---

# feed (the radar)

A feed the Watch follows (`watch.feeds`) and each item it brought (`watch.items`), scored 0-10 on how much it should change how Wren works, against the SOPs pushed with `wren sop push`.

## Why this shape

The radar is the Watch's second input, so it lands in the same Inbox app, never Discord. The score sets the verdict: 7 and up shows (Worth reading), 4 to 6 holds (Worth knowing), the rest drops. Items are kept before they're scored, so a pass that dies loses no reads. Following a feed marks its current items dropped: it scores what comes next, not the back catalog.

## Shape

- `feeds` (`schema.ts:131`): unique url; `fetched_at` (read at most hourly, `FEED_EVERY_MS`), `failure`, `stopped_at` on unfollow
- `items` (`schema.ts:153`): unique url, FK to its feed; `score` 0-10 (check), `verdict`, `changes` (SOP names), `tries` (stops after 3 unreadable answers), `done_at`
- Views `watch.item_records` (queue: needs_you, held, waiting, dropped, done) and `watch.feed_records` (state, items, shown)
- Read: `pullFeeds` (`packages/watch/src/feeds.ts`) in the `Watch/all` pass; score: `scoreItem`, step `scoreStep`; events are `item:<row id>`, kind `item`
- Practices: the worker reads each SOP's newest `content_playbooks` row into name, first paragraph, `##` headings (`practiceOf`)

## Connected to

- **joins:** [[platform/spine]] (workflow `watch`: `read.items` → `score.item` → `out.to_read`)
- **looks-like-but-is-not:** [[watch/mail]] (William's mail, never bodies; feed items are public, text kept); Reddit discovery (reads to find places to talk, not to learn)

## If you change this

- **Hits:** the score prompt and the verdict cut (`verdictOf`), the Inbox app's Worth reading and Feeds pages, WatchConsole `follow`/`unfollow`/`itemDone`
- **Does not hit:** mail triage

## Surfaces

| Surface | Role |
|---|---|
| `Watch/all` on the box, every 15 min, each feed hourly | writes items, emits to Spine |
| Spine `watch.score` (Lambda, `WREN_WATCH_LLM`) | writes scores and verdicts |
| WatchConsole (Inbox app: Follow a feed, Stop following, Done) | writes |
| Inbox app, admins only | reads |

## See

- Source: `packages/watch/src/feeds.ts`
- Design: `designs/2026-10-05-end-goal.md` (#2 radar), `designs/2026-10-05-workflows.md` (The Watch)

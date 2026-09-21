# Content loop: an idea in, one post per platform out

**Status:** built 2026-09-22 (`@wren/content`, `wren content …`, `ContentDesk`, `ContentScheduler`).
**Goal:** MVP item 3 — William types a few lines (or drops a short), the model writes each
platform's version, he reads and approves, the posts go out on schedule through the
channels in `designs/2026-09-21-content-channels.md`. No posting without his approval.

## Shape

```
wren content add ──► content_ideas ──► ContentDesk.draft ──► content_drafts (draft)
                                        one paid step        │
                                        per platform         ▼  wren content approve [--at]
                                                       content_drafts (approved)
                                                             │
                     ContentScheduler/default ◄──────────────┘  due = approved ∧ (scheduled_for ≤ now ∨ null)
                       claim → Content.publish → published | failed
```

Two tables, one package, three surfaces:

- `content_ideas` — his words, an optional `media` (file or URL, kind, title), a source, a status.
- `content_drafts` — one row per (idea, platform): `text`, `title` (YouTube), `media` inherited,
  `extra` handed to the adapter as-is, status `draft → approved → publishing → published | failed`,
  `rejected` from anywhere, `scheduled_for`, the publish stamp (`published_id`, `url`,
  `published_at`), `error`, `prompt_version`, and the LLM envelope (`llm` jsonb) so the raw
  answer and usage sit beside what was stored.
- `ContentDesk/default` (Restate object): `add` and `draft`. Each platform's draft is one
  `ctx.run`, so a crash mid-idea resumes at the next platform and never pays twice. One `runs`
  row per draft request (`content draft`).
- `ContentScheduler/default` (Restate loop object): a pass takes up to 10 due drafts, moves
  each `approved → publishing` in one statement, calls `Content.publish`, stamps the row.
  A `TerminalError` from the channel (no channel configured, the platform refused) lands on
  the row as `failed`; anything else retries under Restate. Cadence: a minute while work
  remains, else until the next `scheduled_for`, else `idleMs` (15 min). Discord gets one line
  per pass with work.
- `ContentDesk.redraft` (2026-09-22): one draft + the person's note ("shorter, keep the
  discord line") → a new row with `redraft_of` and `note`; the old row is rejected as
  superseded. Same gate, same envelope. That is how his taste gets into the model without
  him rewriting by hand.
- CLI: `add`, `ideas`, `draft`, `drafts`, `show`, `approve [--at]`, `reject`, `edit`,
  `redraft <id> "<note>"`, `queue status|start|stop|sync`. Verdicts are rows written straight to Postgres, like the email
  review seat; the paid step and the posting go through Restate.

## Decisions

1. **The model proposes, the code disposes.** `PLATFORM_SPECS` fixes the length, whether a
   video is required, and the shape the model is told to write. A proposal over the limit,
   missing a title where one is needed, or unparseable is not stored; the platform's result
   says why. A platform the idea cannot go to (a Reel with no video) is skipped before any
   call. Not stored ≠ not seen: the tracer and the run row carry it.
2. **One draft per platform, not one post fanned out.** X wants 240 characters, LinkedIn wants
   paragraphs, YouTube wants a title. The same short file rides along on every draft; only
   the words differ. That is the "cross-post hands-off" of the MVP goal.
3. **Voice is a file in his words.** `WREN_CONTENT_VOICE` points at markdown the prompt quotes
   verbatim; the default is his own writing rule. Brand context (name, one line) is in the
   prompt for orientation and never to be pasted into a post.
4. **An edit goes back to `draft`.** What goes out is always text a person approved as
   written. `edited` marks it for later measurement (how often does he rewrite the model?).
5. **`failed` is re-armable.** Approve again after fixing the channel; `claim` guarantees a
   row is posted at most once per approval.
6. **Rows cross Restate's journal as JSON.** A `ctx.run` that returns a row hands back string
   dates; the scheduler reads only text/title/media/extra from them and `nextDue` returns an
   ISO string on purpose. Anything that needs a `Date` re-parses.
7. **The loop shape moved to core.** `makeLoopObject`/`runPass`/`Notifier` now live in
   `@wren/core/restate` and `@wren/core/notify`; channel-email re-exports them. A content
   scheduler must not depend on the email channel.
8. **The LinkedIn-only `notes`/`post_ideas`/`posts` tables stay** (nothing is discarded) but
   the new loop supersedes them; `wren notes …` keeps working until the LinkedIn inbox is
   folded into `content add`.

9. **Metrics are snapshots, one per look.** `content_metrics` keeps every read (a curve, not
   a counter); `ContentMetrics` looks at each post once a day for 30 days through
   `Content.metrics`, then stops. The rank key is engagements per 100 views: platforms with
   very different reach still compare. The Monday report is one line per post, best first,
   sent once per week (object state remembers the week).

10. **The prompt learns from rows, not from a memory.** Notes and winners are re-read per
    draft (`lessonsFor`), so nothing is summarised or lost; the cost is two small queries.
    A note the author gives once is followed on that platform until five newer notes push
    it out — a recurring rule belongs in the voice file.

## Where to attack (ranked)

1. **Nothing has posted for real yet.** The channels wait on credentials (NEEDS-WILLIAM in
   autobrowse); the first approved draft will show whether `Content.publish` through `sites`
   holds up end to end. The stand-in `Content` in the test only proves the loop.
2. ✅ **Notes and winners are remembered** (`lessons.ts`, prompt v2): the platform's last
   five distinct redraft notes and its three best posts (≥20 views, engagement per 100
   views) go into every draft and redraft prompt. Still open: folding a note into the
   voice file itself when it recurs.
3. ✅ **Metrics are read and learned from.** `content_metrics` snapshots (`ContentMetrics`
   loop, one look per post per day for 30 days), `wren content results`, the Monday
   what-worked line, and the winners in the prompt (2).
4. ✅ **Default slots.** `slots.ts`: one slot per platform on `WREN_SEND_TIMEZONE`
   (LinkedIn 08:30 and X 12:00 on weekdays; Facebook 13:00, YouTube 15:00, Instagram 18:00,
   TikTok 19:00 daily); `approve` takes the next one unless `--at`/`--now`. Zone arithmetic
   moved to `@wren/core/time`. Still open: slots learned from metrics, more than one a day.
5. ✅ (2026-09-22) **Media is a path on the laptop.** `content add --media ./short.mp4` now
   puts the file in `WREN_MEDIA_BUCKET` under its content hash and the draft carries
   `s3://bucket/key`; at publish the worker signs it (`s3MediaHost`) and every adapter —
   including YouTube and X, whose autobrowse sites read `file` as a path *or URL* — gets a
   URL the box can fetch. `mediaFileOf` in core is the one rule (URL as is; stored object
   signed; bare path = the box's own disk). Without a bucket, `content add` refuses a local
   file and says so.
6. ✅ **Cost view.** `wren content costs --days 30`: calls and tokens by platform and model
   from each draft's `llm.call.usage` (`costs.ts`, a query, not a DB view). Still no USD:
   prices are not stored anywhere in wren.

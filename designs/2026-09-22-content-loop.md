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
- CLI: `add`, `ideas`, `draft`, `drafts`, `show`, `approve [--at]`, `reject`, `edit`, `queue
  status|start|stop|sync`. Verdicts are rows written straight to Postgres, like the email
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

## Where to attack (ranked)

1. **Nothing has posted for real yet.** The channels wait on credentials (NEEDS-WILLIAM in
   autobrowse); the first approved draft will show whether `Content.publish` through `sites`
   holds up end to end. The stand-in `Content` in the test only proves the loop.
2. **Drafts are one shot.** No "make it shorter" / "more like this one" round-trip; `edit`
   is the whole feedback path. A `redraft --note "…"` that feeds the previous text and the
   note back is the next cheap win.
3. **No learning from metrics.** `Content.metrics` exists; nothing reads it back into the
   prompt (which hooks got views). A weekly "what worked" needs a `content_metrics`
   snapshot table like `post_metrics`.
4. **The scheduler posts on the wall clock, not the platform's best hour.** `--at` is manual.
   A per-platform default slot (e.g. LinkedIn 08:30 fleet time) is a small table away.
5. **Media is a path on the laptop.** The worker on Lambda cannot read `~/Videos/x.mp4`; use a
   URL or `WREN_MEDIA_BUCKET` (S3) today. `content add` could upload to the bucket itself.
6. **One `runs` row per request, no per-call cost line.** `llm` envelope per draft has usage;
   a `content_costs` view over it would make spend visible like `stage_costs`.

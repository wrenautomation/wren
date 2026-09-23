# 1 · Content loop

**Goal:** your idea in, one draft per platform out, you approve, it posts at
that platform's slot, and a week later you know what worked.

```
wren content add ──► content_ideas ──► ContentDesk.draft ──► content_drafts (draft)
                                        one paid step        │
                                        per platform         ▼  wren content approve [--at|--now]
                                                       content_drafts (approved, scheduled_for = next slot)
                                                             │
                     ContentScheduler/default ◄──────────────┘  posts when due through autobrowse `sites`
                     ContentMetrics/default   ◄── looks at each young post daily; Monday: what worked
```

## An idea

```sh
echo "shipped the spend gate today. every buy asks me first." | pnpm wren content add
pnpm wren content add idea.md --media short.mp4 --title "Spend gate"   # a short: YouTube, Reels, TikTok, X, LinkedIn
pnpm wren content add idea.md --platforms linkedin,x
pnpm wren content add idea.md --no-draft                                # store only; `content draft <ideaId>` later
```

Ideas also arrive from ads: `AdsWatch` adds one open idea per winning launch
(`wren content ideas`, source `ads`); `content draft <ideaId>` when you want it.

One paid call per platform in `WREN_CONTENT_CHANNELS` that fits (YouTube
needs a video; a text idea skips it and says so). Drafts follow
`WREN_CONTENT_VOICE` (a markdown file in your words), your last five
redraft notes on that platform, and its three best posts so far.

## Review

```sh
pnpm wren content drafts                       # status draft, one row per platform
pnpm wren content show <draftId>
pnpm wren content redraft <draftId> "shorter, keep the discord line"   # the model rewrites; the old row is rejected
pnpm wren content edit <draftId> fixed.md      # your own text; back to draft
pnpm wren content reject <draftId>...
```

Redraft notes are how your taste reaches the model: they go into the next
prompt on that platform.

## Approve

```sh
pnpm wren content approve <draftId>...                 # each at its platform's next slot
pnpm wren content approve <draftId> --at 2026-09-23T14:00:00Z
pnpm wren content approve <draftId> --now              # the queue's next pass
```

Slots (`WREN_SEND_TIMEZONE`, default America/Chicago): LinkedIn 08:30
weekdays, X 12:00 weekdays, Facebook 13:00, YouTube 15:00, Instagram 18:00,
TikTok 19:00 daily. `packages/content/src/slots.ts`.

## The loops

```sh
pnpm wren content queue start|status|stop|sync      # ContentScheduler/default: posts due drafts
pnpm wren content metrics start|status|stop|sync    # ContentMetrics/default: one look per young post per day
```

Both run on prod already. Posting goes through autobrowse's `sites`
service: the box is woken, the platform's official API posts, a refusal
lands on the row as `failed` with the reason. Discord gets one line per
pass with work.

## What worked, what it cost

```sh
pnpm wren content results --days 7 [--platform x]   # engagements per 100 views, best first
pnpm wren content costs --days 30                   # calls and tokens by platform and model
```

Monday's first metrics pass sends "content: what worked, week of …" to the
channel. The winners feed the next drafts.

## Media

A local `--media` file lands in `WREN_MEDIA_BUCKET` first (the worker and
the box cannot read this laptop); every platform gets a signed URL at
publish. A URL is used as is. Instagram posts through the box's browser
composer until Meta is set up: the box downloads the signed URL, then uploads.

## Where it breaks

| Symptom | Cause | Fix |
|---|---|---|
| draft row `failed: no youtube channel configured` | platform not in `WREN_CONTENT_CHANNELS` on prod | add it, push, `queue sync` |
| `failed: … no token for linkedin` | autobrowse has no token for the site | autobrowse guide 2/4: `site setup <site> consent` |
| nothing posts, `queue status` shows `running: false` | loop never started after a fresh env | `content queue start` |
| draft text ignores the voice | `WREN_CONTENT_VOICE` unset on prod | point it at the voice file in the bundle |

Design: `../designs/2026-09-22-content-loop.md`.

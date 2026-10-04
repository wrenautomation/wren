---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:306
---

# thread-event

One inbound thing that happened on an enrollment's thread: reply, bounce, auto-reply, unsubscribe, receipt. Table `thread_events`.

## Why this shape

The mailbox is the source of truth; the harness never infers an outcome (`packages/channel-email/src/inbox/sync.ts:1`). One row per Gmail id (`uq_thread_events_gmail_id`, `:332`) makes a re-sync free of consequence. The reply's meaning is a separate, later column: `disposition` with its `disposition_source` (rule | operator | llm), and the LLM never overwrites an operator (`inbox/disposition.ts:1`).

## Shape

- `enrollment_id`, `in_reply_to_message_id`, `kind`, `bounce_class`, `disposition`, `disposition_source`, `classified_at`, `gmail_id`, `gmail_thread_id`, `from_address`, `subject`, `snippet`, `headers`, `body_text`, `classification`, `received_at`, `run_id` (`:307`–`326`)

Citations: `packages/channel-email/src/schema.ts:306`

## Connected to

- **owned-by:** [[email/enrollment]]
- **joins:** [[email/message]], [[leads/suppression]] (the evidence a stop cites), [[email/sender-pause]] (hard bounces trip the switch)

## If you change this

- **Hits:** `inbox/sync.ts:422`, `:762`; `inbox/inbound.ts:474` (the pure classifier's kinds mirror `THREAD_EVENT_KINDS` by value); `inbox/disposition.ts:337`; `inbox/health.ts:90`; views `reply_outcomes`, `reply_by_evidence`, `review_outcomes` (`views.ts:132`, `:215`, `:233`); the digest; the console views `email_campaign_records`, `email_reply_records`, `email_reply_thread` (migration 0061)
- **Does not hit:** `open_events`; the send tick

## Surfaces

| Surface | Role |
|---|---|
| `InboxScheduler/{sender}` | writes |
| `Disposition/fleet` | writes `disposition` (source llm) |
| `EmailConsole/answers`, `/approve`, `/drop` (console; approve and drop go through `Disposition/fleet`) | reads, drives |
| `wren email reply/event` | writes operator labels |

## See

- Source: `packages/channel-email/src/inbox/sync.ts`

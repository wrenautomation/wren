---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 979997e3 (+ training record batch 2)
entity: packages/core/src/schema.ts:650
---

# draft-event

One step in a draft's life, of any kind: written, edited, approved, rejected, sent, failed. Table `draft_events`, the training record (`designs/2026-10-07-training-record.md`).

## Why this shape

Append-only, so the first version and its prompt can't be written over. One narrow table beside `changes` and template versions: neither has a model as author, a prompt, a reject reason, a sent text or rounds. `item` is the Inbox id (`draft:<uuid>`, `comment:<id>`, `thread:<id>`, `dm:<contact>`, `invite:<contact>`, `video:<id>`). A DM contact gets one round per draft (`packages/core/src/draft-record.ts:93`). `ref` is unique, so a journaled step or the backfill never adds twice. Not audited (`AUDIT_SKIPPED`).

## Shape

- `item`, `round`, `kind`, `platform`, `event`, `via` (model, person, claude, wren), `by`, `text`, `title`, `ask`, `reason` (`REJECT_REASONS`, `packages/core/src/reject-reasons.ts:2`), `note`, `llm` (prompt, system, model, usage, raw answer on a model's `generated`), `slot`, `external_id`, `url`, `meta`, `run_id`, `ref`, `at`

Live steps take the database's clock as each row is written (`clock_timestamp()`); only the backfill and a video's first words set `at`. Reads order by `(at, id)`; `draft_activity.seq` is the step's id for the Activity tab.

Citations: `packages/core/src/schema.ts:650`, `packages/core/src/draft-record.ts:93`, `packages/core/src/train.ts`, `packages/content/src/train-backfill.ts`

## Connected to

- **owned-by:** none: keyed by `item`, no foreign keys, so it outlives a deleted draft
- **joins:** [[content/draft]], [[content/comment]], [[content/reddit-thread]], [[content/linkedin-invite]] (DM contacts), [[content/video-edit]], `runs` (`run_id`)

## If you change this

- **Hits:** the export and pairs (`packages/core/src/train.ts`), the backfill (`packages/content/src/train-backfill.ts`, keyed by `bf:` refs), the views `draft_activity`, `draft_outcomes`, `draft_people` (`packages/content/src/schema.ts`), the record page (`draftRecordOf`, `apps/portal/web/src/modules/marketing/versions.tsx`), and every `recordDraft` call: `packages/content/src/{draft,review,queue,draft-ask,video}.ts`, `packages/outreach/src/{comments,drafts,linkedin-posts}.ts`, `packages/outreach/src/discovery/threads.ts`, `packages/studio/src/edit.ts`, `keepSentEdit` (`packages/core/src/ask.ts`)
- **Does not hit:** `changes` (the records layer's field edits) or `runs` (still written as before)

## Surfaces

| Surface | Role |
|---|---|
| drafting (`draftIdea`, `redraft`, `sortComment`, `draftThread`, `draftDm`) | write `generated` with the prompt |
| the draft box, Ask Claude, Undo, `wren drafts set`, `wren content edit`, a changed send | write `edited` |
| `ContentDesk.approve/reject`, `MarketingConsole.rejectDraft`, `wren content reject --reason --note`, drop and skip | write decisions |
| `ContentScheduler`, `markAnswered`, `markCommented`, `queueDraft` | write `sent` / `failed` |
| every draft page: Versions section (`draftRecordOf` in each `load`) and Activity tab (`draft_activity`) | read |
| `wren train export`, `wren train pairs`, Export JSONL on draft lists (records `drafts`) | read: `wren.draft/1`, `wren.pair/1`, people out by default |
| `wren train backfill [--dry-run]` | write history from `content_drafts`, `runs`, `audit_events`, `comments`, `reddit_threads`, `reach_messages`, `video_edits`; skips items with live steps |

## See

- Source: `packages/core/src/draft-record.ts`
- Design: `designs/2026-10-07-training-record.md`

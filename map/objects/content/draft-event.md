---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 3781504 (+ training record)
entity: packages/core/src/schema.ts:650
---

# draft-event

One step in a draft's life, of any kind: written, edited, approved, rejected, sent, failed. Table `draft_events`, the training record (`designs/2026-10-07-training-record.md`).

## Why this shape

Append-only, so the first version and its prompt can't be written over. One narrow table beside `changes` and template versions: neither has a model as author, a prompt, a reject reason, a sent text or rounds. `item` is the Inbox id (`draft:<uuid>`, `comment:<id>`, `thread:<id>`, `dm:<contact>`, `invite:<contact>`, `video:<id>`). A DM contact gets one round per draft (`packages/core/src/draft-record.ts:93`). `ref` is unique, so a journaled step or the backfill never adds twice. Not audited (`AUDIT_SKIPPED`).

## Shape

- `item`, `round`, `kind`, `platform`, `event`, `via` (model, person, claude, wren), `by`, `text`, `title`, `ask`, `reason` (`REJECT_REASONS`, `packages/core/src/reject-reasons.ts:2`), `note`, `llm` (prompt, system, model, usage, raw answer on a model's `generated`), `slot`, `external_id`, `url`, `meta`, `run_id`, `ref`, `at`

Citations: `packages/core/src/schema.ts:650`, `packages/core/src/draft-record.ts:93`

## Connected to

- **owned-by:** none: keyed by `item`, no foreign keys, so it outlives a deleted draft
- **joins:** [[content/draft]], [[content/comment]], [[content/reddit-thread]], [[content/linkedin-invite]] (DM contacts), [[content/video-edit]], `runs` (`run_id`)

## If you change this

- **Hits:** every `recordDraft` call: `packages/content/src/{draft,review,queue,draft-ask,video}.ts`, `packages/outreach/src/{comments,drafts}.ts`, `packages/outreach/src/discovery/threads.ts`, `packages/studio/src/edit.ts`, `keepSentEdit` (`packages/core/src/ask.ts`)
- **Does not hit:** `changes` (the records layer's field edits) or `runs` (still written as before)

## Surfaces

| Surface | Role |
|---|---|
| drafting (`draftIdea`, `redraft`, `sortComment`, `draftThread`, `draftDm`) | write `generated` with the prompt |
| the draft box, Ask Claude, Undo, `wren drafts set`, `wren content edit`, a changed send | write `edited` |
| `ContentDesk.approve/reject`, `MarketingConsole.rejectDraft`, `wren content reject --reason --note`, drop and skip | write decisions |
| `ContentScheduler`, `markAnswered`, `markCommented`, `queueDraft` | write `sent` / `failed` |

## See

- Source: `packages/core/src/draft-record.ts`
- Design: `designs/2026-10-07-training-record.md`

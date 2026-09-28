---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/research/src/schema.ts:62
---

# enrichment

What a model (or a scan) proposed about a document or company, kept as JSON until applied. Table `enrichments`.

## Why this shape

Agentic proposes, deterministic disposes: a proposal is a row with `applied_at` null until `applyExtractions` or `applyPicks` writes real facts. `output.call` carries the normalized `CallRecord` (`packages/llm/src/audit.ts:19`), so cost is read from the row that spent it.

## Shape

- `document_id`, `company_id`, `kind` (`ENRICHMENT_KINDS`, `packages/research/src/schema.ts:23`), `model`, `prompt_version`, `output`, `applied_at`, `run_id` (`:65`–`74`)

Citations: `packages/research/src/schema.ts:62`

## Connected to

- **owned-by:** [[research/document]], [[leads/company]], [[ledger/run]]
- **owns:** nothing; applying writes [[leads/person]] and the email pick
- **joins:** `email_llm_calls`, `email_stage_costs` views (`packages/channel-email/src/views.ts:15`, `:40`)

## If you change this

- **Hits:** `packages/research/src/enrichment/store.ts:50`, `email-scan.ts:245`, `email-pick/`, `extraction.ts`; the two cost views; disposition's audit record (`packages/channel-email/src/inbox/disposition.ts`)
- **Does not hit:** `content_drafts.llm` (the content loop keeps its own record)

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.scan/extract/pick` | write |
| `Enrichment.applyExtractions/applyPicks` | read, set `applied_at` |

## See

- Source: `packages/research/src/enrichment/store.ts`

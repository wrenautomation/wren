---
type: object
cluster: ledger
universe: leftover
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/core/src/schema.ts:23
---

# llm-call

The old per-call spend table `llm_calls`. No writer exists in this tree; the live record of a model call is the `CallRecord` stored beside the output that used it.

## Why this shape

The Python era wrote one row per call. The TS port keeps the record next to the artefact instead: `enrichments.output.call` for research and disposition, `content_drafts.llm` for drafts (`packages/llm/src/audit.ts:19`, `packages/content/src/schema.ts:88`). The table stays for the legacy rows and for `channel-linkedin/status.ts:66`, which sums it.

## Shape

- `provider`, `model`, `prompt_name`, `prompt_hash`, `stage`, token counts, `cost_usd`, `seconds`, `request_id` (`packages/core/src/schema.ts:27`–`37`)

Citations: `packages/core/src/schema.ts:23`; no `insert(llmCalls)` anywhere under `packages/*/src` or `apps/*/src`

## Connected to

- **looks-like-but-is-not:** `email_llm_calls` view (`packages/channel-email/src/views.ts:15`) reads `enrichments`, not this table; `wren content costs` reads `content_drafts.llm` (`packages/content/src/costs.ts`)

## If you change this

- **Hits:** `packages/channel-linkedin/src/status.ts:66` (leftover); the `posts.llm_call_id` reference (`packages/channel-linkedin/src/schema.ts:141`)
- **Does not hit:** any live spend surface

## Surfaces

| Surface | Role |
|---|---|
| `wren status` (leftover) | reads |
| none | writes |

## See

- Source: `packages/core/src/schema.ts`; live record: `packages/llm/src/audit.ts`

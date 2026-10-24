---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ 5cab22cf
entity: packages/llm/src/client.ts:30
---

# llm-client

The model seam: `LlmClient`, called only through `completeAndParse`, which parses, validates and returns a normalized `CallRecord` beside the result.

## Why this shape

Every paid step is one function with one shape, so a model never disposes: extraction, the email pick, reply disposition, SMS labels and content drafts all propose through here and are gated by code after (`stage.ts:62`, `audit.ts:1`). The record lives beside the artefact it produced, not in a central table (see [[ledger/llm-call]]). A fake client exists for tests; on the worker, disposition binds only with a real model (`apps/worker/src/services/deps.ts:488`).

## Shape

- `LlmClient` (`client.ts:30`), `completeAndParse` (`stage.ts:62`), `CallRecord`, `recordFor` (`audit.ts:19`, `:104`), optional tracing (`tracing.ts`)
- `WREN_LLM` and `WREN_LLM_MODEL` choose provider and model
- usage at the seam: `observeUsage(llm, { part, record })` and `withPart` (`packages/llm/src/usage.ts`); a call's `CompleteOptions.part` names the part asking, the wrapper reports each response's `Usage` (with `cache_read` and `cache_write`) to `record`. The worker wraps every Anthropic client it builds once (`counted` in `apps/worker/src/services.ts`) and the record writes the `anthropic` vendor row ([[platform/vendors]]); a failed write is logged, never the call. `makeLlm` itself knows no database, so the CLI's own clients are not counted
- reach drafts pick a model per item: `ArmedLlm` wraps the Monitor's client, `modelFor(llm, item)` returns the arm's client by hash of the item id (`packages/outreach/src/draft-llm.ts`, setting `drafts.model`, `packages/core/src/draft-models.ts`)

Citations: `packages/llm/src/client.ts:30`, `packages/llm/src/stage.ts:62`

## Connected to

- **joins:** [[research/enrichment]] (`output.call`), [[email/thread-event]] (`classification`), [[sms/sms-message]] (`classification`), [[content/draft]] (`llm`)
- **joins:** [[platform/decide]] (the gateway answers when Jev is down)

## If you change this

- **Hits:** every caller of `completeAndParse`; the `anthropic` usage rows (a changed `raw.usage` key breaks `usageFromRaw` and the cost); the `email_llm_calls` view's JSON paths (`packages/channel-email/src/views.ts:16`); `wren content costs`
- **Does not hit:** anything deterministic downstream of a gate

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment`, `Disposition`, `SmsWatch`, `ContentDesk` | call |

## See

- Source: `packages/llm/src/stage.ts`

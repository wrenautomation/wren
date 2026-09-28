---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/llm/src/client.ts:30
---

# llm-client

The model seam: `LlmClient`, called only through `completeAndParse`, which parses, validates and returns a normalized `CallRecord` beside the result.

## Why this shape

Every paid step is one function with one shape, so a model never disposes: extraction, the email pick, reply disposition, SMS labels and content drafts all propose through here and are gated by code after (`stage.ts:62`, `audit.ts:1`). The record lives beside the artefact it produced, not in a central table (see [[ledger/llm-call]]). A fake client exists for tests; on the worker, disposition binds only with a real model (`apps/worker/src/services.ts:182`).

## Shape

- `LlmClient` (`client.ts:30`), `completeAndParse` (`stage.ts:62`), `CallRecord`, `recordFor` (`audit.ts:19`, `:104`), optional tracing (`tracing.ts`)
- `WREN_LLM` and `WREN_LLM_MODEL` choose provider and model

Citations: `packages/llm/src/client.ts:30`, `packages/llm/src/stage.ts:62`

## Connected to

- **joins:** [[research/enrichment]] (`output.call`), [[email/thread-event]] (`classification`), [[sms/sms-message]] (`classification`), [[content/draft]] (`llm`)

## If you change this

- **Hits:** every caller of `completeAndParse`; the `email_llm_calls` view's JSON paths (`packages/channel-email/src/views.ts:15`); `wren content costs`
- **Does not hit:** anything deterministic downstream of a gate

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment`, `Disposition`, `SmsWatch`, `ContentDesk` | call |

## See

- Source: `packages/llm/src/stage.ts`

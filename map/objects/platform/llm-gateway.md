---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-29 @ ef481a93
entity: apps/llm-gateway/src/worker.ts:193
covers: ["@wren/llm-gateway"]
stamp: 098626c8
---

# llm-gateway

llm.wrenautomation.com: one OpenAI-compatible endpoint over every free LLM key we hold (Gemini, OpenRouter, Cohere). A Cloudflare Worker, app `@wren/llm-gateway` (`apps/llm-gateway`).

## Why this shape

Free tiers cap per key, so the gateway holds every key and routes: a key with room from the ledger, the next key on a 429 or a dead key, the next model when a model's keys are spent (`route.ts`). Keys go round-robin, not by score: every key is the same free tier. The ledger is a Durable Object (`KeyLedger`, `worker.ts:42`), pure over a `save` hook so tests run in memory; it holds counts per key and model, a cooldown after a 429 (2, 4, 8, 15 min), and a model cooldown when the model itself is the trouble. Key text never enters the ledger: keys are numbered by their line in the secret. Each caller has its own bearer token (the secret holds only sha256 hashes) and three limits: a refilling faucet of requests per minute, requests per UTC day, paid tokens per UTC day; the same three apply to all callers together (`guard.ts`). A paid request reserves its prompt plus max completion up front and settles on what the reply used. It runs on Cloudflare, so it takes no memory on the box or the Mac.

## Shape

- `POST /v1/chat/completions`: `model` is an alias (`free`, `cohere`) or `<provider>/<model>` (`catalog.ts:83`)
- `GET /v1/models`; Gemini's own API on the same keys: `POST /v1beta/models/<model>:generateContent`, `embedContent`, `batchEmbedContents` (a YouTube URL to read, embeddings)
- `GET /usage` (each model's keys, each caller's use today); `POST /reset` (admin callers: clears the key ledger after the keys change); `/health` is the only open route
- callers `prod` (the Lambda and the box worker, `WREN_LLM=gateway`) and `william` (admin, bulk tests) (`guard.ts:24`)
- per-model free limits come from keycycle's `sync_models.py`; a model missing takes its provider's default; a 429 is the real limit (`catalog.ts`)

Citations: `apps/llm-gateway/src/worker.ts:1`, `apps/llm-gateway/src/ledger.ts:34`, `apps/llm-gateway/src/guard.ts:24`

## Connected to

- **owned-by:** [[platform/llm-client]] (`packages/llm` calls it: `WREN_LLM_GATEWAY_URL`, `gatewayGemini` in `packages/llm/src/gateway.ts`)
- **joins:** [[platform/decide]] (the gateway answers when Jev is down)
- **looks-like-but-is-not:** engine `@wrenautomation/models` key rings (in-process rotation, no service)

## If you change this

- **Hits:** `packages/llm` (client and Gemini fetch), the `prod` and `william` tokens, keycycle's limit sync
- **Does not hit:** paid Anthropic calls (they go direct, not through here)

## Surfaces

| Surface | Role |
|---|---|
| Lambda, box worker, William's machine | call it |
| `/usage` | reads the ledger |

## See

- Source: `apps/llm-gateway/src/`

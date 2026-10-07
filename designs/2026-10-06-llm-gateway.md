# LLM gateway (2026-10-06)

One OpenAI-compatible endpoint, `https://llm.wrenautomation.com/v1`, over every free LLM key
we hold: 89 Gemini, 31 OpenRouter, 1 Cohere. Source in `apps/llm-gateway`.

## Why

- `RotatingLlm` rotates keys inside one process. Each Lambda call starts fresh, so key state
  was lost and the Lambda had no Gemini or OpenRouter keys at all.
- The box (4 GB) and Docker on the Mac keep running out of memory. A Cloudflare Worker with
  a Durable Object uses neither, and fits the free plan (100k requests a day, SQLite DOs).
- keycycle stays frozen. Nothing imports it.

## How it routes

- `model` is an alias or `<provider>/<model>`.
  - `free`: Gemini flash 3.8 → 3.7 → 3.6 → 3.5, then flash-lite, then Gemma 4 31B, then
    OpenRouter free models.
  - `free-bulk`: Gemma first (14,400 a day per key), for volume.
  - `cohere`: Command A, then Command R7B. Paid from Cohere credits (production key, 500 a
    minute, no daily cap), for bulk tests that would drain the free keys.
- One Durable Object (`KeyLedger`) counts each key's requests per model this minute and this
  provider-day. Gemini's day is Pacific; the others' is UTC. Limits are in `src/catalog.ts`.
- A key comes round-robin from those with room. On failure:

  | Upstream answer | What happens |
  |---|---|
  | 429 | key cools 2 → 4 → 8 → 15 min |
  | 429 "per day" | key is spent until the provider's day turns |
  | 401, 403 or bad key | key benched 24 h on every model |
  | 5xx | key cools 30 s |
  | 429 from a shared upstream pool | next model; the key isn't blamed |
  | 404 | next model |
  | other 4xx | goes back to the caller as is |

- Six keys per model, then the next model. When every key is spent: 429 with `retry-after`.
- Gemma's inline `<thought>…</thought>` moves to `reasoning_content` (non-streamed replies).
- `GET /usage`: per model, keys ready, cooling, spent, dead, today's count and recent errors.
  Keys show by index only. `POST /reset` clears the ledger.

## Run it

- Bearer `WREN_LLM_GATEWAY_TOKEN` (in `deploy/prod.env`) on every route but `/health`.
- In wren: `WREN_LLM=gateway` or `gateway:<model>`, with `WREN_LLM_GATEWAY_URL` and
  `WREN_LLM_GATEWAY_TOKEN` set.
- Keys change: `node scripts/secrets.mjs run deploy/prod.env -- 'node scripts/llm-gateway-keys.mjs'`.
  It reads llm.env, sets the Worker secrets (one key per line; inline `# notes` dropped),
  deploys and resets the ledger. CI's `wrangler deploy` keeps the secrets.

## Credit and caution

Routing ideas from [freellmapi](https://github.com/tashfeenahmed/freellmapi) (MIT, Tashfeen
Ahmed): a per-key ledger, the 2/4/8/15 cooldown, and failover key, then model. Not taken:
its anonymous reseller providers, and bandit scoring (all our keys are the same free tier).
Its ToS review says providers allow one account per person. Many free keys on one provider
can get them all banned. That risk was there before the gateway, which only uses keys we
already hold.

## Decisions

- 2026-10-06: Worker + DO, not a container on the box or the Mac (memory). $0.
- 2026-10-06: prod `WREN_LLM` flipped from `cohere:command-a-03-2025` to `gateway` (William).
  `WREN_FILL_LLM` stays on Cohere direct.

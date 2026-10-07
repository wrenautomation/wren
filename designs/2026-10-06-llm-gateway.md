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

## Guardrails

- **Callers.** Each caller has its own random 256-bit bearer token. The Worker's
  `GATEWAY_CALLERS` secret holds only their sha256 hashes.
  - `prod` is the Lambda and the box. Its token is in `deploy/prod.env` and SSM.
  - `william` is the Mac. Its token is in llm.env.
  - To revoke or rotate one, change it and rerun the keys script.
  - Not JWTs: there are two server-side callers, a hash revokes at once, and the limits cap
    any leak.
- **Limits per caller and for all callers together** (`src/guard.ts`):

  | | requests a minute (faucet) | requests a day | paid tokens a day |
  |---|---|---|---|
  | prod | 300 | 50,000 | 250,000 |
  | william | 120 | 20,000 | 1,000,000 |
  | all | 600 | 100,000 | 1,000,000 |

  - The faucet is a bucket of that many requests that refills evenly over each minute: a
    burst, then a drip.
  - Days are UTC.
  - A paid request (Cohere) reserves prompt bytes / 4 plus its max completion, then settles
    on the reply's `usage`. 1M paid tokens a day costs at most about $10 of Command A.
- **Over a limit:** 429 with `Retry-After` and `x-ratelimit-*` headers showing what's left
  this minute, today, and in paid tokens today. Every reply carries those headers.
- **Requests:** body up to 1 MB, `max_tokens` cut to 8,192, `n` must be 1, messages
  required, listed providers only.
- **Slow upstreams:** each try gets 20 s; a stream gets 20 s to send its headers. A timeout
  or a full shared pool skips that model for 10 min. The whole request gets 100 s, then 504.
- `POST /reset` is admin only (william) and never clears the callers' counts.
- Workers Logs: one line per request (caller, model, winner, status, ms), never content.

## Run it

- A caller's bearer `WREN_LLM_GATEWAY_TOKEN` on every route but `/health`.
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

- 2026-10-07: per-caller tokens and limits, timeouts and model skip, after William said he
  "still want[s] these safeguards".
- 2026-10-06: Worker + DO, not a container on the box or the Mac (memory). $0.
- 2026-10-06: prod `WREN_LLM` flipped from `cohere:command-a-03-2025` to `gateway` (William).
  `WREN_FILL_LLM` stays on Cohere direct.

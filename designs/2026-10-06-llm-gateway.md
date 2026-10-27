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
  - `free`: OpenRouter's free models, best first (Nemotron 3.5 super VL, Nemotron 3.5
    lightning, Gemma 4 31B, Gemma 4 26B). Until 2026-10-27 it was Gemini flash 3.8 → 3.5,
    flash-lite, Gemma, then OpenRouter; `free-bulk` (Gemma first) went the same day.
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

## 2026-10-27: the keys we have left

What the ledger and a real run show today:

- Gemini: 88 keys, 53 suspended (403), the rest 503 "high demand" or timeouts. A weaver run
  through `free` got 51 hits, 6 reads and 14 findings, then died in extract: every Gemini key
  spent or cooling, OpenRouter Gemma 429 upstream, Nemotron 3 super 404 (gone). Rotation gets
  caught: William drops Gemini keys.
- Cerebras and Groq keys: dead (never in the gateway). Cohere: 1 production key on credits,
  0 calls today. Anthropic: $200 a month of credits; prod already calls it direct for the
  watch and fills.
- Anthropic's Messages API takes images (url or base64), so vision needs no Cohere. Anthropic
  has no embeddings and cannot read a YouTube URL. Its OpenAI-compatible endpoint takes
  `image_url`, ignores `response_format` and prompt caching, and Anthropic calls it "not a
  long-term or production-ready solution".
- Gemini also carried two things no other provider does: `learn`'s embeddings
  (`gemini-embedding-001`, 256-dim unit vectors stored per item) and weaver's "on screen" read
  of a YouTube video straight from its URL.

### The goal

Every production call lands. The $200 a month is the budget and we cap it in dollars. One
interface per repo. No shim between us and Claude. The least custom code.

### Options

| | A. Worker + Anthropic through its OpenAI-compatible endpoint | B. Worker + a native Messages translator | C. A framework gateway on the VPS (Bifrost, Go, ~120 MB; or LiteLLM, Python, ~400 MB) | D. Claude direct through the SDK; the Worker keeps only free and Cohere |
|---|---|---|---|---|
| Code | one provider entry; a dollar ledger in the guard | ~200 lines of request and SSE translation, plus the dollar ledger | none of ours; a service to install, keep and watch | delete Gemini and the native passthrough; prod `WREN_LLM=anthropic:…` |
| Every call lands | one more hop; a layer Anthropic does not stand behind | one more hop; our translator is the risk | one more hop on a VPS without Cloudflare's uptime; the VPS down = prod LLM down | the SDK's own retries, no hop |
| Spend cap | ours, per caller, once the guard counts dollars per model | same | per virtual key, in dollars, built in | Anthropic workspace limit ($200) plus one API key per caller in the console |
| Claude features | no caching, no structured outputs, thinking not returned | all, if the translator is right | all (Bifrost and LiteLLM speak Messages natively) | all |
| One door | yes | yes | yes, and an Anthropic-format door too | two: `anthropic` and `gateway`, both names `client.ts` already takes |

Priorities, ranked: every production call lands; spend capped in dollars; least custom
code; full Claude features. A and B fail the first or the third. C is the ideal shape, but a
VPS service is a new thing to keep up and a new way for prod to go down, for a cap the
Anthropic console already gives.

### Decision: D

William chose D (2026-10-27) and left the SDK question to this session: "fold the SDK into
the interface?" The check that decided it: `@ai-sdk/anthropic` 4.0.57 already exposes what
Claude 5 needs (`effort`, adaptive `thinking`, `cacheControl`, `stop_reason: refusal`), so
`makeLlm` stays the one door and gains them. A second interface on `@anthropic-ai/sdk` would
be a second door for nothing. The `.d.ts` was read, not assumed.

- `packages/llm` `makeLlm`: `anthropic` defaults to `claude-haiku-5-5`; `anthropic:haiku`,
  `anthropic:sonnet`, `anthropic:opus` name the current Claude 5.5 models and a full id passes
  through. `CompleteOptions.effort` (`low` … `max`) reaches Anthropic as a provider option; a
  Claude 5 model thinks adaptively inside `maxTokens`. Smoke (a fill-shaped call, 2048
  budget): 0 reasoning tokens at default and at `low`, about a second a call. The `gemini`
  provider and its `AIza` key prefix go; groq, cerebras, mistral and openai stay for a
  client's own key (`llmForKey`), which is theirs, not ours.
- Prod `WREN_LLM=anthropic:haiku`. `WREN_WATCH_LLM` and `WREN_FILL_LLM` stay on their Claude
  4.5 ids this pass; they move to `anthropic:sonnet` and `anthropic:haiku` when the watch's
  usage line is checked after. Haiku 5.5 is $0.10 in / $0.50 out per MTok; Sonnet 5.5
  $2 / $10. At Haiku prices $200 is about 400M input tokens a month.
- William sets a $200 a month workspace spend limit in the Anthropic console and makes one
  API key per caller (prod, the Mac), so the console shows spend per caller. Money is his.
- The Worker's `free` is the OpenRouter `:free` models that answer today, best first
  (Nemotron 3.5 super VL: text, image, video, 1M context; Nemotron 3.5 lightning; Gemma 4 31B
  and 26B, which are rate-limited upstream by Google AI Studio most of the day); `free-bulk`
  goes. `cohere` stays as is. The `/usage` page is the judge of which free models stay.
- The gemini provider, `GEMINI_KEYS` and the native `/v1beta` passthrough STAY in the Worker:
  `learn`'s embeddings (`gatewayEmbed`, `gemini-embedding-001`) and the worker's YouTube
  on-screen reads (`gatewayGemini` in `executor.ts`) still go through them, and answered
  today (embeddings HTTP 200). They leave with the two migrations below, not before.
- OpenRouter keys checked at `/auth/key`: 31 keys, every one free tier, all authenticate.
  Gemma `:free` answers 429 "temporarily rate-limited upstream"; Nemotron 3.5 `:free`
  answers.
- Followed by, not in this pass:
  - Embeddings: a new model is a new space, so every stored vector is re-embedded. Cohere
    `embed-v5.0-pro` direct (it needs `input_type` and `output_dimension`, which the
    compatibility endpoint lacks), or Voyage. Own decision, own migration.
  - YouTube "on screen" reads: lost when Gemini goes. The way back is falcon's frames path
    (yt-dlp, ffmpeg frames) with Claude vision. Captions still read.
  - weaver `--model anthropic` for a Mac without Claude Code; `claude -p` covers it today.

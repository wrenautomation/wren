# 0 · Setup

**Goal:** `pnpm wren` works; a local stack runs the same loops as prod.

```sh
cd ~/Documents/wren_automation/wren
pnpm install
cp .env.example .env                 # WREN_DATABASE_URL for the compose Postgres is the default
docker compose up -d                 # Postgres :5434, Restate ingress :8080, admin :9070
pnpm db:migrate                      # every migration in packages/db/drizzle (NOTICEs about existing schema are fine)
pnpm wren db check                   # migrations applied: 9
pnpm worker                          # the Restate endpoint on :9080, keep it running
pnpm register                        # once per worker restart: tells the compose Restate where it is
pnpm wren status
```

## Pointing the CLI at production

Most `wren` commands read the database and call Restate. Two settings pick
which:

```sh
WREN_DATABASE_URL=…                     # deploy/terraform: tofu output -raw database_url
WREN_RESTATE_INGRESS_URL=https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080
RESTATE_AUTH_TOKEN=…                    # the Restate Cloud API key; the CLI sends it as the bearer
```

`walkthrough/demos/prod.sh <command>` sets the first two for one command
(the token is read from `.env`). Never paste either value into a commit.

## Models

`WREN_LLM=fake` (default) answers nothing useful; the content loop needs a
real one: `anthropic`, `cohere:command-a-03-2025`, `groq:…`, `gemini:…`,
`openrouter:…`. Keys live in `llm.env` (gitignored): `WREN_ANTHROPIC_API_KEY`,
or a fleet `NUM_COHERE=2`, `COHERE_API_KEY_1`, `COHERE_API_KEY_2`. Prod keeps
them in SSM `/wren/prod/env`.

## Gates

```sh
pnpm gates                           # biome + typecheck, unit, integration (Docker: testcontainers)
pnpm gates unit
```

CI runs the same on every push; `deploy` follows `ci` on main.

## Layout

```
apps/cli            pnpm wren …
apps/worker         every Restate service and loop; lambda.ts is the prod entry
packages/core       time, notify, restate loop helper, content types, runs
packages/db         drizzle, migrations, testing (startTestPostgres)
packages/config     settings ← env, ingressOf
packages/llm        providers, key fleets, audit
packages/content    ideas, drafts, review, slots, metrics, lessons, costs, restate/
packages/channel-*  email, linkedin, meta (ads + Page/IG posts), youtube, x, tiktok
packages/research   the lead pool, discovery, enrichment
packages/niches     per-niche registries (agencies, …): the core stays niche-agnostic
```

Rules: deps point down; channels never import each other; every package
owns `src/schema.ts` listed in `packages/db/drizzle.config.ts`; Restate
handlers in `src/restate/`, pure step functions beside them.

# Wren platform: TypeScript monorepo spec

Date: 2026-09-17. Status: approved.

## 1. Why

One language front and back. Automations are the product; LLM calls are one step inside them. Both Python repos (`emails_gen`, `wren_linkedin_content`) migrate here. Client deliverables live in separate repos and depend on this one.

## 2. Stack (exact pins, `save-exact`)

| Concern | Choice | Pin |
|---|---|---|
| Runtime | Node | >= 24 (`engines`), `.node-version` |
| Package manager | pnpm workspaces | 9.15.0 (`packageManager`) |
| Task runner | Turborepo | 2.10.13 |
| Language | TypeScript | 5.9.3 (TS 7 is a rewrite; revisit in 2027) |
| Durable execution | Restate | server `restatedev/restate:1.7.10`, SDK `@restatedev/restate-sdk` 1.17.1 |
| DB | Postgres 17, Drizzle ORM 0.45.2, drizzle-kit 0.31.10, postgres.js 3.4.9 | |
| Validation / env | zod 4.6.5 | |
| LLM seam | Vercel AI SDK `ai` 7.0.105 + `@ai-sdk/anthropic` | |
| Web (later) | Next.js 16, React 19 | not in Phase 1 |
| Lint/format | Biome 2.5.14 | |
| Tests | Vitest 5.0.1, `@testcontainers/postgresql` 12.1.0, `@restatedev/restate-sdk-testcontainers` | |
| Logs | pino 10 | |
| CLI | commander 15 | |

## 3. Layout

```
apps/web                Next.js dashboard, CRM, approvals (Phase 6+)
apps/worker             Restate endpoint; registers every channel's services
apps/cli                `wren` ops commands; thin, calls packages or Restate ingress
packages/config         env parsing (zod), one place
packages/db             Drizzle client, migration runner, test helpers
packages/core           channel-agnostic domain + schema: niches, leads, contacts,
                        campaigns, messages(channel col), approvals, events, llm_calls
packages/content        templates as rows (niche, channel, arm, variant) + renderer
packages/llm            provider seam, prompt registry, spend cap
packages/research       web research + enrichment
packages/channel-linkedin  notes, ideas, posts, metrics, competitors, OAuth, publish
packages/channel-email     Resend adapter, sequences, follow-ups, reply parse
```

Phase 1 creates: config, db, core (llm_calls only), channel-linkedin, apps/worker, apps/cli. Others appear when first needed.

## 4. Rules

1. Dependencies point down: apps → channel-* → {core, content, llm, research} → {db, config}. Never sideways between channels.
2. Each package owns its Drizzle schema in `src/schema.ts`. `packages/db` aggregates them for drizzle-kit; migrations live in `packages/db/drizzle/`.
3. Niches and templates are rows. Reorganizing them is a migration, never a refactor.
4. Workflows and Restate handlers live in the channel package under `src/restate/`. Pure step functions live beside them with no Restate import and are unit-tested without a server.
5. All I/O inside a handler goes through `ctx.run("name", fn)`. Handler code outside `ctx.run` must be deterministic.
6. Schema rules carry over from the Python spec: plural table names, units in column names, every `*_id` is a FK (SET NULL, CASCADE for child metrics), SET NULL FK columns indexed, counters CHECK >= 0, status columns are strings.
7. Exact version pins. Renovate-style bumps are deliberate commits with the gate green.

## 5. Concurrency

Restate Virtual Objects replace advisory locks and `SKIP LOCKED`:
- `LinkedinInbox` keyed `"default"`: `ingest()` is single-writer, so two ingests serialize.
- `Post/{id}`: `publish()`, `approve()`, `captureMetrics()` are single-writer per post.
- Spend cap: `LlmBudget/{yyyy-mm}` object owns the month's total; `reserve(usd)` rejects over cap.
- Postgres isolation stays READ COMMITTED. Idempotency: every `ctx.run` that inserts uses a natural key or `ON CONFLICT DO NOTHING`.

## 6. Environments and secrets

- `.env` (gitignored) read by `packages/config`; `.env.example` committed. Prefix `WREN_`.
- Dev: `docker compose up` gives Postgres (127.0.0.1:5433) and Restate (ingress 8080, admin 9070). Worker runs on 9080 and self-registers via `pnpm register`.
- Prod: Restate Cloud or one VM with the binary; Postgres managed; worker as a container. Secrets via env only.
- CI: GitHub Actions, `pnpm turbo lint test`, integration tests use testcontainers.

## 7. Migration order

1. Phase 1 LinkedIn (this spec, plan `2026-09-17-phase-1-skeleton-ts-plan.md`).
2. LinkedIn phases 2–5 (plans rewritten from the Python ones).
3. emails_gen: `core` gains leads/contacts/campaigns/messages; `content` gains templates; `channel-email` gains Resend + sequences; launchd job becomes a Restate scheduled workflow.
4. `apps/web`.

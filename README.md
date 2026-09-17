# wren

Wren Automation platform. One TypeScript monorepo: durable automations on Restate, Postgres via Drizzle, dashboard in Next.js (later). Spec: `designs/2026-09-17-platform-spec.md`.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres :5434, Restate ingress :8080 admin :9070
pnpm db:migrate
pnpm worker                   # Restate endpoint on :9080 (keep running)
pnpm register                 # tell Restate where the worker is (once per worker restart)
pnpm wren status
```

## Daily use (LinkedIn channel)

```bash
# drop notes in inbox/ as <stem>.md with optional <stem>.png / <stem>-2.jpg
pnpm wren notes ingest
echo "an idea" | pnpm wren notes add
pnpm wren notes ls --status new
pnpm wren status              # exit 1 on Thursday+ with no draft
```

## Gates

`./scripts/gates.sh` runs lint + typecheck, unit tests, integration tests (Docker). CI runs the same.

## Layout

See spec §3. Rules: deps point down; channels never import each other; every package owns `src/schema.ts` and `packages/db/drizzle.config.ts` lists them; Restate handlers in `src/restate/`, pure step functions beside them.

## Schema changes

Edit a package's `src/schema.ts`, then `pnpm db:generate` (writes `packages/db/drizzle/NNNN_*.sql`; review it), then `pnpm db:migrate`. Never edit a committed migration.

## Legacy data

`scripts/import-legacy.sh [db]` copies every row from the emails_gen Postgres into a migrated wren database. Run once, into an empty target. See `designs/2026-09-17-channel-email-port-plan.md`.

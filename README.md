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

## Content loop (every platform)

```bash
echo "shipped the spend gate today. every buy asks me first." | pnpm wren content add
pnpm wren content add idea.md --media short.mp4 --title "Spend gate"   # a short: YouTube, Reels, TikTok, X, LinkedIn captions
pnpm wren content drafts                 # one row per platform, status draft
pnpm wren content show <draftId>
pnpm wren content redraft <draftId> "shorter, keep the discord line"   # the model rewrites from your note
pnpm wren content edit <draftId> fixed.md
pnpm wren content approve <draftId>...   # posts on the queue's next pass
pnpm wren content approve <draftId> --at 2026-09-23T14:00:00Z
pnpm wren content queue start            # ContentScheduler/default: posts approved drafts as they come due
```

Drafts follow `WREN_CONTENT_VOICE` (a markdown file in your words) and go out through the
channels in `WREN_CONTENT_CHANNELS`. A local `--media` file lands in `WREN_MEDIA_BUCKET`
first (the worker and the box cannot read this laptop); a URL is used as is. Design: `designs/2026-09-22-content-loop.md`.

## Chores through autobrowse

`restateDo(ctx, wake)({ goal: "upload this to youtube", inputs: { file } })` from a
handler, `autobrowseDo({ url, token })` from a laptop: one verb, autobrowse routes
it (site API → compiled workflow → its agent, which compiles what it did for next
time). `restateSites(ctx)` stays for calls that need the official API shape.

## Gates

`./scripts/gates.sh` runs lint + typecheck, unit tests, integration tests (Docker). CI runs the same.

## Layout

See spec §3. Rules: deps point down; channels never import each other; every package owns `src/schema.ts` and `packages/db/drizzle.config.ts` lists them; Restate handlers in `src/restate/`, pure step functions beside them.

## Schema changes

Edit a package's `src/schema.ts`, then `pnpm db:generate` (writes `packages/db/drizzle/NNNN_*.sql`; review it), then `pnpm db:migrate`. Never edit a committed migration.

## Legacy data

`scripts/import-legacy.sh [db]` copies every row from the emails_gen Postgres into a migrated wren database. Run once, into an empty target. See `designs/2026-09-17-channel-email-port-plan.md`.

## Deploy

Restate Cloud → Lambda → Postgres on EC2. `deploy/README.md` is the runbook; `deploy/terraform` the infrastructure; CI ships `main` after `ci` is green.

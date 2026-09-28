# wren

Wren Automation platform. One TypeScript monorepo: durable automations on Restate, Postgres via Drizzle, dashboard in Next.js (later). Spec: `designs/2026-09-17-platform-spec.md`.

New here: `walkthrough/` is the guided path (setup → content loop → Meta ads →
email campaign → production) with read-only demos against prod.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres :5434, Restate ingress :8080 admin :9070
pnpm db:migrate
pnpm worker                   # Restate endpoint on :9080 (keep running)
pnpm register                 # tell Restate where the worker is (once per worker restart)
ln -s "$PWD/bin/wren" ~/.local/bin/wren   # the CLI, compiled on first run and after every source change
wren status
```

## Daily use (LinkedIn channel)

```bash
# drop notes in inbox/ as <stem>.md with optional <stem>.png / <stem>-2.jpg
wren notes ingest
echo "an idea" | wren notes add
wren notes ls --status new
wren status              # exit 1 on Thursday+ with no draft
```

## Content loop (every platform)

```bash
echo "shipped the spend gate today. every buy asks me first." | wren content add
wren content add idea.md --media short.mp4 --title "Spend gate"   # a short: YouTube, Reels, TikTok, X, LinkedIn captions
wren content drafts                 # one row per platform, status draft
wren content show <draftId>
wren content redraft <draftId> "shorter, keep the discord line"   # the model rewrites from your note
wren content edit <draftId> fixed.md
wren content approve <draftId>...   # each posts at its platform's next slot (LinkedIn 08:30 weekdays, X noon, IG 18:00 … on WREN_SEND_TIMEZONE)
wren content approve <draftId> --at 2026-09-23T14:00:00Z
wren content approve <draftId> --now  # on the queue's next pass
wren content queue start            # ContentScheduler/default: posts approved drafts as they come due
wren content metrics start          # ContentMetrics/default: one look per young post per day; Monday = what-worked to the channel
wren content results --days 7       # published posts, engagement per 100 views, best first
wren content costs --days 30        # drafting calls and tokens by platform and model
```

Drafts follow `WREN_CONTENT_VOICE` (a markdown file in your words), your last redraft notes
on that platform and its best posts so far, and go out through the channels in
`WREN_CONTENT_CHANNELS`. A local `--media` file lands in `WREN_MEDIA_BUCKET`
first (the worker and the box cannot read this laptop); a URL is used as is. Design: `designs/2026-09-22-content-loop.md`.

## Meta ads

```bash
wren ads accounts                    # the ad accounts the Meta token admins
wren ads interests "shopify"         # interest ids for the spec's targeting
wren ads launch ads/founders.json    # campaign → ad set → creative → ad, all PAUSED; prints the ids
wren ads start <campaignId> <adsetId> <adId> --daily 20   # the one command that spends
wren ads insights --preset last_7d   # spend, impressions, reach, clicks, ctr, cpc per campaign
wren ads stop <campaignId>
wren ads lead-form founders https://wrenautomation.com/privacy   # an instant form; id → creative.leadForm
wren ads leads <formId>              # what the form collected (needs leads_retrieval from app review)
wren ads launches                    # the ad_launches ledger: ids, budget, started/stopped, why
wren ads watch start                 # AdsWatch: daily guard, pauses a launch that spent $50 with nothing to show
wren ads spec-from <draftId> --out ads/post.json   # a post that worked → a PAUSED launch spec (same words, same media)
```

The spec file: `name`, `objective` (OUTCOME_LEADS, OUTCOME_TRAFFIC, …), `dailyBudgetUsd`,
`targeting {countries, ageMin, ageMax, interests[{id,name}]}`, `creative {message, link,
headline, description, callToAction, media {kind, source}, leadForm {id} | {name, privacyUrl,
questions?, followUpUrl?}}`. With `leadForm` (OUTCOME_LEADS, `optimizationGoal:
LEAD_GENERATION`) the CTA opens the instant form on Facebook instead of the link, and
`wren ads leads <formId>` reads the answers. A local media file lands in
`WREN_MEDIA_BUCKET` first. Every ACTIVE write is a spend on the box: it asks (or auto-yes
under its small cap) and writes the ledger. `WREN_META_AD_ACCOUNT_ID` picks the account;
unset = the first one. Every launch/start/stop lands in `ad_launches`; `AdsWatch/default`
reads adset insights once a day and stops any active launch whose 7-day spend reached
`WREN_ADS_PAUSE_AFTER_USD` (default 50) with zero clicks and zero results — it only ever
stops spend, and each pass is one message to the channel. A launch that wins (a result,
or ten clicks) becomes one open idea for the content loop (`wren content ideas`, source
`ads`), once; nothing is drafted until you say. The other way: `wren ads spec-from
<draftId>` turns a published post into a spec. Design:
`designs/2026-09-22-meta-ads.md`.

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

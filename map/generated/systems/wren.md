# wren: system

Campaigns, channels and client products

## Inside

- **Restate server** (store, restate 1.7 in Docker on EC2 wren-prod-pg): Every loop journal, timer and object state; the only always-on piece
- **Lambda worker** (app, Node 22 arm64, Lambda wren-prod-worker): Every service except the box ones
- **Box worker** (app, Node on EC2 wren-prod-pg): PoolScheduler, Discovery, Enrichment, Resolution, PageArchive, Books, Watch, SocialWatch
- **Postgres 17** (store, EC2 wren-prod-pg, PgBouncer 6432)
- **Valkey cache** (store, EC2 wren-prod-pg, 6380): Saves a slow read for every Lambda: today only the Restate admin reads, 5 minutes
- **browserless Chromium** (app, Docker on EC2 wren-prod-pg)
- **Sign-in** (app, Lambda wren-prod-auth)
- **Portal** (app, Cloudflare Worker)
- **Phone** (app, Cloudflare Worker)
- **LLM gateway** (app, Cloudflare Worker + Durable Object): Every free Gemini, OpenRouter and Cohere key behind one endpoint
- **wren CLI** (app)

## Calls

- wren.restate → wren.worker (calls): invokes
- wren.restate → wren.box (calls): invokes
- wren.restate → autobrowse (calls): invokes the desk worker over cloudflared
- wren.worker → wren.postgres (calls): reads and writes
- wren.box → wren.postgres (calls): reads and writes
- wren.worker → wren.valkey (calls): cache
- wren.worker → wren.browserless (calls): CDP
- wren.box → wren.browserless (calls): CDP
- wren.cli → wren.restate (calls): ingress
- wren.worker → autobrowse (calls): platform calls
  - here: `packages/core/src/content/restate.ts`
  - there: `../autobrowse/src/sites/service.ts`
- wren.worker → ssm (calls): tokens and credentials
  - here: `packages/core/src/content/renewal.ts`
  - there: `../credvault/src/env-store.ts`
- wren → lander (calls): offers snapshot
  - here: `packages/offers`
  - there: `../lander/src/data/offers.json`
- wren.worker → lander (calls): clicks and visits; demo videos
  - here: `packages/channel-email/src/inbox/clicks.ts`, `packages/video/src/publish.ts`
  - there: `../lander/functions/api/export.ts`, `../lander/functions/v/[id].ts`
- wren.box → autobrowse (calls): fetch ladder
  - here: `packages/research/src/restate/enrichment.ts`
  - there: `../autobrowse/src/sites/web.ts`
- wren.box → mailifier (calls): address probes
  - here: `packages/channel-email/src/verification/verifier.ts`
  - there: `../mailifier/src/server.ts`
- wren.worker → gmail (calls): mail read and send
  - here: `packages/channel-email/src/access/mailbox.ts`
- wren → autobrowse (uses): vendor pieces on npm: mail, google, oauth
- wren → engine (uses): the read layer on npm: weaver, falcon, models

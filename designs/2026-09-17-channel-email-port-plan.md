# channel-email port plan (emails_gen → wren)

Spec: `2026-09-17-platform-spec.md`. Source inventory: `2026-09-17-emails-gen-inventory.md`.

## Goal

Move the email outreach system into the TS monorepo with the email flow, DB and
enrichment intact. Python keeps running until the TS side is proven; sends switch last.

## Approach: exact schema first, refactor after

The 22 tables and 16 views are ported **object-for-object** from the live DB
(`drizzle-kit pull`, then cleaned). Integer ids, constraint names, index column
order and CHECK text are kept, so `pg_dump --data-only` restores unchanged and
nothing is lost. Cleanups (uuid ids, splitting jsonb blobs, templates as rows)
come later as ordinary migrations with tests.

Proof, in CI: `packages/channel-email/test/integration/legacy-parity.test.ts`
loads the committed `pg_dump --schema-only` fixture into a second database and
asserts columns, constraints, indexes and view definitions are identical.
Proof, on real data (2026-09-17): `scripts/import-legacy.sh` restored 892 MB
(31k companies, 84k people, 270k sightings, 486k candidates) in 52 s; row
counts, sequence values and view outputs matched the live DB.

### Package placement

| Package | Tables | Views |
|---|---|---|
| `core` | runs, imports, import_errors, companies, people, sightings, leads, suppressions, suppression_events | person_facts, agency_facts, firm_facts |
| `research` | documents, enrichments | — |
| `channel-email` | contact_candidates, verifications, template_versions, enrollments, messages, thread_events, open_events, open_syncs, inbox_syncs, sender_pauses, postmaster_days | the other 13; `llm_calls` → `email_llm_calls`, `stage_costs` → `email_stage_costs` (names clash with `core.llm_calls`) |

Dependency tiers: db/config → core → research → channel-* → apps.
Moving a table between packages later is free (the migration diff is empty).

### Typing

Every CHECK-enumerated column is declared once as a `const` tuple
(`MESSAGE_STATES`, `ENROLLMENT_STATES`, …) used by both `varchar({ enum })` and
`oneOf(...)`, so the DDL and the TS union cannot drift. `jsonb` columns are
`unknown` until each step types its own shape (E2+).

## Steps

| # | Scope | Parity proof |
|---|---|---|
| E1 ✅ | schema in core/research/channel-email, migration `0001`, parity test, `scripts/import-legacy.sh` | parity test; live restore |
| E2 ✅ | domain: state transition tables (lead in core; message/enrollment/candidate in channel-email), email helpers (`core/emails.ts`), pattern vocabulary. jsonb shapes are typed by the stage that writes them (E3–E7), not up front | `domain/` unit tests ported 1:1 (63 tests) |
| E3a ✅ | ingestion: `core/ingest/` (CSV source, edge classification, countries, importer), `core/runs.ts` ledger | `test_ingestion_schema` (unit) + `test_importer` (integration) ported 1:1; run-ledger tests that need enrichment land with E4 |
| E3b ✅ | people: `core/people/` (name parsing, PersonRow, importer) | `test_people_schema` + `test_people_importer` ported 1:1 |
| E3c ✅ | verify: `core/doh.ts`, `channel-email/verification/` (local checks, fake + MillionVerifier, funnel service) | `test_doh`, `test_local_checks`, `test_verifiers`, `test_verification_service` ported 1:1 |
| E3d ✅ | discovery: `research/discovery/` (candidates, ownership gate, discovery + verification runs; `fetchHomepage` is an injected seam, the polite-fetcher default lands with E4) | `test_discovery` + `test_discovery_service` ported 1:1 |
| E4 ✅ | enrichment: polite fetcher, crawl, render (Playwright), scan, extraction, email pick (typed steps + AI SDK, no LangGraph), resolution; cache key `(subject, kind, model, prompt_version)` kept. Restate objects `Enrichment` (keyed by niche or `all`) and `Resolution` wrap the per-unit functions, one journaled step per company/document/domain. Niche-specific parts (extraction prompt/version, crawl hints, generic words) are parameters for a later niche registry | same fixtures; fake LLM; fake browser. Not ported: Langfuse adapter (tracer seam kept), CLI ledger printing tests. `readable.py` moves to E5 |
| E5 ✅ | template DSL parser + compose + sequences (+ `readable.py`, preview/enumerate). `Template.version` hashes the Python repr, so all 10 live template versions match (`packages/niches/test/golden.json`, generated from the Python repo). `.email` files live in `@wren/niches` (typed registry: facts view, lander, crawl hints, generic words, templates, sequences, `companyLocation`) and are seeded into `template_versions` on first compose. Provenance `verified_at` keeps Python's isoformat shape; booleans stringify JS-style. Compose takes a `Queryable` and commits one transaction per company, so it runs stateless on Lambda | golden parity tests; `test_outreach.py` + `test_role_inbox.py` ported as integration suites. Deliver/send tests move to E6 |
| E6 ✅ | send: policy, deliver, Gmail DWD transport, roster; daemon → `SendScheduler/{sender}` virtual object with durable sleeps; intent-before-act and Message-ID minting kept. `packages/channel-email/src/send/` holds the port: pure Intl clock math (no tz lib), smol-toml roster, hand-rolled RS256 JWT-bearer + Gmail REST, the walk with its own transactions per intent/outcome (relock under `FOR UPDATE SKIP LOCKED`). `SendScheduler` handlers: `tick` (once), `start`/`stop`/`loop` (durable delayed self-call: gap after a send, next window open when closed, tick interval otherwise), `status`. Worker binds it on `ConsoleTransport`; `WREN_SEND_TRANSPORT=gmail` is the cutover switch. Kill switches are an injectable hook filled in E7 | console transport; no real sends until cutover. `test_outbox.py` + send half of `test_outreach.py` → `outbox.test.ts` (37); `restate-send-scheduler.test.ts`; 239 unit tests |
| E7 ✅ | inbox: `packages/channel-email/src/inbox/` — dependency-free MIME reader (`rfc822.ts`, Python `email` semantics kept: walk order, `message/*` not descended, delivery-status blocks as header groups), `inbound.ts` classifier (bounce → receipt → auto-reply → unsubscribe → reply, RFC 3464 + heuristic NDR, embedded-original id), `sync.ts` (per-message transaction, `ON CONFLICT DO NOTHING RETURNING` dedupe, cursor floor/overlap, match order in_reply_to → references → thread → embedded original → from, C-D9 mismatch rule), `health.ts` (domain health, kill switches, pause/resume, `send_health`), `opens.ts`, `postmaster.ts` (v2, retry, scope/activation errors), `disposition.ts` (propose → ground gate, `classification` jsonb feeds `email_llm_calls`). Kill switches are now `sendTick`'s default. Restate: `InboxScheduler/{sender}` (sync every `WREN_DAEMON_SYNC_SECONDS`, one tick after a failure, hands replies to `Disposition/fleet` when a real LLM is configured), `PostmasterScheduler/fleet` (daily at local midnight, bound only with `WREN_POSTMASTER_USER`), `OpensScheduler/fleet` (bound only with `WREN_PIXEL_BASE_URL` + `WREN_PIXEL_EXPORT_TOKEN`); all share `restate/loop.ts`. Suppress tests ported too | `.eml` fixtures copied; `inbound.test.ts` (27), `inbox.test.ts` (22), `health.test.ts` (14), `open-tracking.test.ts` (10), `postmaster.test.ts` (11), `disposition.test.ts` (10 unit + 8), `suppress.test.ts` (12 unit + 13), `restate-inbox-scheduler.test.ts` (5) |
| E8 ✅ 2026-09-19 | weekly report rebuilt as `ReportScheduler/weekly` (durable loop, Friday 19:00 fleet clock): `report/weekly.ts` collects this week vs to date by campaign/niche/arm, deliverability, replies worth reading, pool + pace, a deterministic Monday line; row in `reports` (0002), mailed via the send transport to `WREN_REPORT_TO`. No `claude -p`: the numbers are the queries. `wren report weekly` prints one without mail | Friday 2026-09-25 19:00 ET is the first live one |

| E9 ✅ 2026-09-19 | deploy: `apps/worker/src/services.ts` builds every service once; `main.ts` serves it on Node, `lambda.ts` on Lambda (`createEndpointHandler`, secrets from one SSM JSON param via `ssm-env.ts`). `scripts/build-lambda.mjs` → `dist/lambda.zip` (esbuild ESM, templates beside it, playwright-core for Browserbase). `browserbaseRenderer` (research) behind the same `BrowserRenderer` interface; `WREN_RENDERER=local\|browserbase`. `loadServiceAccountKey` takes the key JSON inline. `deploy/terraform`: EC2 t4g.small + Docker postgres:17 (TLS-only, scram, own EBS volume, EIP, nightly pg_dump → S3), Lambda + role, Restate invoker role (trust policy from the Cloud UI), GitHub OIDC CI role, SSM params. `deploy/README.md` runbook; `.github/workflows/deploy.yml` migrates, publishes a version, registers it. Verified locally: bundled handler answers `/discover` with every service; `tofu validate` clean. Applied 2026-09-19 (us-east-1): 24 resources, prod DB migrated, Lambda v1 registered with Restate Cloud as `dp_12xEDpaYDDkQBOMUz0r1QEp`, `SendScheduler/smoke/status` answers 200 through the ingress. Renderer is self-hosted browserless on the DB box (`WREN_RENDERER=cdp`), Browserbase optional. No `senders_config.toml` in the bundle yet — nothing can send until cutover. Trust policy taken from restate-cdk (UI did not show one). Gitignored secrets live in `deploy/prod.env`, `deploy/github-secrets.env`, `deploy/terraform/terraform.tfvars` | smoke invoke through Restate Cloud; migrations run from CI |

## Cutover (after E9) — ✅ done 2026-09-19 00:40 ET

Python daemon stopped 23:2x ET; 1,140 leads / 382 enrollments / 764 messages / 84k people /
31k companies copied into prod (counts verified equal); private files copied to `wren/legacy/`
(gitignored); roster pushed to SSM `/wren/prod/senders_config` (CI checkouts have no roster,
so the Lambda reads it from SSM at cold start); `WREN_SEND_TRANSPORT=gmail`,
`WREN_OPEN_TRACKING=false` (new flag: the Python daemon never embedded the pixel); Lambda v3
registered as `dp_11AXYXxRQEuPbtmVEfwpzYl`; all 10 inboxes' `SendScheduler` + `InboxScheduler`
loops and both fleet loops started. First ticks: sends sleep 61 h to Monday 13:00 ET (window
closed), inbox syncs clean, Postmaster 5 domains clean. Python compose down, launchd report
unloaded; `emails_gen_pgdata` volume and both repos kept locally until a clean send day.
Also fixed: CI OIDC role now trusts the `environment:production` subject.

Original steps:

1. Pause the Python daemon (`docker compose --profile campaign stop app`).
2. `pnpm db:migrate`, then `scripts/import-legacy.sh` into the wren DB.
3. Start the wren worker; register; enable the send scheduler.
4. Copy `senders_config.toml` values into `.env`/rows; move the service-account path.
5. Copy every gitignored/private file out of the Python repos into the monorepo before
   deleting them: `llm.env`, `senders_config.toml`, `.env`, `data/`, `reports/`,
   `~/.config/emailsgen/*` → under `wren/` (gitignored) so nothing lives only in emails_gen.
6. `docker compose --profile campaign down` in emails_gen, `launchctl unload` the
   weekly-report plist, then delete the local Python repos (GitHub copies stay).

## Queue-keeper (2026-09-19)

The one manual step left in the ramp SOP was "keep the approved queue ahead of tomorrow's
cap". `ComposeScheduler/{niche}` (`restate/compose-scheduler.ts`) does it daily: capacity ×
`WREN_COMPOSE_DAYS_AHEAD` minus approved unsent openers, composed through the niche's
`plan` (`outreach/plan.ts`: ordered `{ sequence, where }` rules, validated at registry
load — every sequence known, only the last rule may be ungated). Auto-approve is the
default because every draft so far was approved unread in bulk; review stays possible
(`WREN_COMPOSE_DAYS_AHEAD=0` unbinds the object). Arms are decided by data
(`agency_facts.segment`), not by a `--arm` flag, so the enrolled copy always matches the
firm and the lander. The 382 `operations-days-0-5` enrollments from the Python campaign
keep their stored text and finish on their own; new enrollments use the DRAFT 12
marketing/build arms that the site continues.

## After cutover

- `wren onboard-domain` (asked 2026-09-18): a durable workflow for a new sending domain.
  API-first — Cloudflare DNS, Workspace user + DKIM via Admin SDK, `gcloud` for keys — with
  browser steps only where no API exists (Postmaster registration, the DWD grant), run in a
  persistent logged-in browser profile (Browserbase context or a dedicated Chrome profile),
  and an approval gate before anything that spends. Credentials stay in vendor sessions and
  stored payment methods, never in prompts.

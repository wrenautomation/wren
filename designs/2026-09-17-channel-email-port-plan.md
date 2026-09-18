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
| E7 | inbox sync, disposition, health, opens, postmaster, suppress, reconcile | `.eml` fixtures |
| E8 | weekly report: keep `claude -p`, point it at `wren` commands | manual |

| E9 | deploy: Restate Cloud (free tier) → AWS Lambda endpoint for the worker (handlers already stateless per invocation); Postgres in Docker on a small EC2 instance; renderer behind an interface so Browserbase can replace local Playwright. Later: self-hosted Restate on Kubernetes. Wren stays general-purpose: nothing niche- or channel-specific in the deploy layer | smoke invoke through Restate Cloud; migrations run from CI |

## Cutover (after E9)

1. Pause the Python daemon (`docker compose --profile campaign stop app`).
2. `pnpm db:migrate`, then `scripts/import-legacy.sh` into the wren DB.
3. Start the wren worker; register; enable the send scheduler.
4. Copy `senders_config.toml` values into `.env`/rows; move the service-account path.
5. `docker compose --profile campaign down` in emails_gen, `launchctl unload` the
   weekly-report plist, then delete the local Python repos (GitHub copies stay).

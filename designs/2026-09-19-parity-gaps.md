# emails_gen → wren parity (2026-09-19)

What the Python system did, and where each piece stands in wren. Source:
`designs/2026-09-17-emails-gen-inventory.md`, checked against code and prod on
2026-09-19/20. Four buckets: **kept** (same function, ported), **rebuilt**
(same function, different shape), **dropped by design**, **open**.

## Kept (ported, running in prod)

| Function | wren |
|---|---|
| Import (CSV, header aliases, sightings, supersede) | `core/ingest`, `wren ingest`, `wren email import <csv> --niche` |
| Domain discovery + verification (DoH, ownership gate) | `research/discovery`; `Discovery/{niche}/discover|verify` (Restate, added 2026-09-20) |
| Pool growth end to end | `PoolScheduler/{niche}` (new 2026-09-20; Python ran each stage by hand) |
| Crawl → render → scan → extract → apply → pick → apply | `Enrichment/{niche}/*` handlers, one bounded pass each |
| Candidate build → queue → resolve (local checks, MillionVerifier) | `Resolution/fleet/build|queue|resolve` |
| Templates (`.email` block tree, arms, variants) | `channel-email/outreach/templates|authoring`, niche dirs |
| Compose (facts → readable → provenance) | `outreach/compose.ts`, person + role-inbox kinds |
| Send policy (window, lead window, ramp, gap, cooldown) | `send/policy.ts` |
| Paced walk, intent-before-act, reconcile | `send/deliver.ts`, `send/reconcile.ts`, `SendScheduler/{inbox}` |
| Gmail transport (DWD service account) | `send/gmail.ts` |
| Inbox sync, bounce/OOO/unsubscribe classes, cursor overlap | `inbox/sync.ts`, `InboxScheduler/{inbox}` |
| Reply disposition (LLM, quote-grounded) | `Disposition/fleet` |
| Kill switches, sender pauses | `inbox/health.ts`, `wren email senders pause|resume` |
| Suppression (address/domain, lift, check) | `wren email suppress` |
| Postmaster daily pull | `PostmasterScheduler/fleet` |
| Open pixel pull | `OpensScheduler/fleet` (pixel worker still the Cloudflare one) |
| Friday report | `ReportScheduler/weekly` (mails; no `claude -p` narrative) |
| Run ledger, stage costs, provenance views | `runs`, `stage_costs`, `send_health`, `agency_facts`, `person_facts` |
| Roster (`senders_config.toml`, signature `{page}` slot) | `send/roster.ts` |
| Lead timezone fill | `send/lead-timezone.ts`, runs inside every compose pass |

## Rebuilt (same job, new shape)

| Was | Now | Why |
|---|---|---|
| `emailsgen daemon` in Docker on the laptop | Restate Cloud loops on Lambda | laptop-off crash 2026-09-17; timers outlive any process |
| Daily `outreach compose` by hand | `ComposeScheduler/{niche}`: keeps 3 send days of approved openers queued through the niche `plan` | nothing by hand once a niche has leads |
| Discord notifier (Python) | `notify.ts`: replies, bounces, pauses, dry pool, stage error edges, 07:00 digest | counts only, never text or addresses |
| `outreach status`, `inbox replies`, `senders`, `suppress` | `wren email status|replies|senders|suppress` | one command group, same tables |
| `EMAILSGEN_*` env | `WREN_*` env, SSM `/wren/prod/env` | one secrets surface |
| alembic + models.py | Drizzle schema + migrations | TS |
| pytest markers | Vitest unit + `test/integration` (testcontainers) | TS |

## Dropped by design

| Function | Reason |
|---|---|
| Langfuse tracing | not paid for; `Tracer` seam kept, `WREN_TRACING` |
| keycycle key fleets (groq/gemini/openrouter/…) | one Cohere key in prod; `makeLlm` seam takes any provider |
| Google Sheets snapshot / people surface | sheet was repair-only; Postgres is the store |
| `heartbeat_url` | never set in Python either |
| `enrichment/shard.py` CLI sharding | Restate keys + `shard` input on crawl cover it |
| weekly report via `claude -p` narrative | report mails numbers; the narrative was a laptop launchd job |

## Open (real gaps, in the order to close them)

1. ~~Nothing loops the research chain.~~ Closed 2026-09-20: `PoolScheduler/{niche}`
   (`restate/pool-scheduler.ts`) walks discover → verify → crawl → render → scan →
   extract → pick → applyPicks, a minute apart while there is work, then daily.
   `WREN_POOL_MODEL_STAGES` gates spend (`none` default; `pick` is what makes
   leads; `all` adds extraction). Not started in prod: starting it with `pick` is
   a spend decision (Cohere production tier; sec_ria has 19,237 uncrawled domains).
2. ~~Niche lead-source formats~~ Closed 2026-09-20: `agency-directory-csv`,
   `clutch-pages`, `shopify-pages` (`niches/src/agencies/`), `sec-investment-advisers`,
   `sec-firm-feed` and the `adv-filing-data` people format (`niches/src/sec-ria/`),
   registered on each `Niche` and merged in `LEAD_SOURCE_FORMATS` /
   `PERSON_SOURCE_FORMATS`; `wren email import --format`, `import-people`, `formats`.
   Old unit tests ported (46) plus one importer round-trip per family. The `fetch get`
   datasets followed the same day: `Dataset`/`fetchDataset` in `research/fetch`, the
   four SEC catalogs and the Shopify profile crawl on their niches, `wren fetch list|get`.
3. ~~Review commands~~ Closed 2026-09-20: `channel-email/src/outreach/review.ts`
   (listDrafts, approveMessages, rejectMessages, editMessage, stopByHand; 11 tests)
   behind `wren email drafts|show|approve|reject|edit|stop|preview` (`cli/src/review.ts`).
   Same rules as Python: ids may re-arm `failed`, `--all` is draft-only, stopped
   enrollments refused, the original pinned under `provenance.review` on edit.
4. ~~`inbox reply`~~ Closed 2026-09-20. It never sent mail: it labelled a reply's
   disposition or recorded one that came in off-channel. Now `wren email reply
   --event N | --enrollment N --disposition …` and `wren email event N` (with
   `address via` and `source page`); `replies` prints the event id.
5. ~~`senders check --send`~~ Closed 2026-09-20: `wren email senders check [--niche] [--send]`; mint verified on all 10 inboxes, `--send` round-robins one test mail inside the fleet through `GmailTransport`.
6. ~~Reads~~ Closed 2026-09-20: `wren email outcomes|opens|postmaster`; `address via`
   is a column of `drafts` and a line of `show` / `event`.
7. **`setup` domain tooling** (RDAP, Porkbun pricing, Cloudflare DNS records).
8. ~~sops~~ Copied 2026-09-20 with a header mapping old commands to wren ones.
9. **Pixel worker source** (`infra/pixel/`) lives in `legacy-private`; the
   deployed Cloudflare worker keeps running.
10. `SUPPRESSED→IMPORTED` un-suppress and `UNDELIVERABLE→IMPORTED` were never
    implemented in Python either.

## Checked and fine

- Postmaster shows `days_without_data: 5`: Google publishes nothing for a domain
  under its daily volume floor; 50–70 sends over five domains is under it. Last
  data rows are from August, when the Python fleet sent more per domain.
- Compose reports `timezones: 338 unresolved`: those companies' `Location` holds
  the company name (a shifted column in the Clutch export). 48 of them have a lead;
  they send on the fleet clock. 697 of 745 lead-bearing agencies have a zone.

- Reply capture: every "Re:" in the fleet inboxes on 2026-09-20 was spam from
  throwaway domains with no In-Reply-To. Zero real replies exist; the matcher is
  not dropping any.
- The 42 agencies picks without a lead are person guesses in resolution (35
  candidate, 7 queued), waiting on MillionVerifier credits. Free credits only.

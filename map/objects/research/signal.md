---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-06 @ 0deedf9
entity: packages/research/src/schema.ts:228
---

# signal

A dated, linked fact about a firm or person that makes a message relevant now: news, a post, hiring, a job change, the tech stack, a site change, a talk, a demand post. Not a table: a `findings` row with `signal_at` set, read through the view `research_signals`. One collector per source writes them; `signal_checks` holds each collector's answer per subject (designs/2026-10-06-signal-collectors.md).

## Why this shape

Findings already dedupe on `fact_key`, keep the raw in `documents`, and feed briefs, scores and `postFacts`; a second table would split every reader. The database refuses a dated row with no link or of a non-signal kind. `keepFinding` dates a signal kind from its value when the writer gives no date (`signalDate`, `packages/research/src/findings.ts:75`); collectors go through `keepSignal` (`findings.ts:107`), which also refuses a draft with no raw. `signal_checks` paces each collector by its own bucket and `everyDays` without re-reading findings.

## Shape

- `findings.signal_at`, `findings.signal_dated` (`published` | `approx` | `seen`), partial index where set (`schema.ts:228`)
- view `research_signals`: id, kind, topic, company_id, person_id, subject, title, url, at, dated, via, confidence, document_id, first_seen, seen, age (`schema.ts:272`)
- `signal_checks`: pk (`collector`, `subject`), `state` (found | none | unresolved | capped), `found`, `tried`, `answer`, `retry_at`, `run_id`, `checked_at` (`schema.ts:601`). A subject is `c<id>`, `p<id>` or a post key.
- collectors: `packages/research/src/signals/` (contract `index.ts:100`, registry `collectors.ts`)

Citations: `packages/research/src/schema.ts:228`, `packages/research/src/signals/index.ts:232` (due), `:454` (runner), `:499` (`signalsFor`)

## Connected to

- **owned-by:** [[leads/company]], [[leads/person]]
- **produces:** `findings` rows; `signal_checks` rows
- **looks-like-but-is-not:** the lander's Signals (visitor events and replay); `crm run`'s `signals` stage (hiring, `packages/reactivation/src/signals.ts`), which writes the same `hiring` findings

## If you change this

- **Hits:** `keepFinding` (every findings writer), the backfill in the `*_signals` migration, `googleLeft` (signals take at most 50 of 200 searches, `packages/research/src/enrichment/profiles.ts`), the pool's `signals` stage, the `research.signal` record and the firm record's related list
- **Does not hit:** `factsFor`, `postFacts` (nothing is merged into them)

## Surfaces

| Surface | Role |
|---|---|
| `PoolScheduler/{niche}` stage `signals` | writes, once a collector is built and on |
| `Enrichment/<niche>/signals {"personIds":[...],"timezone":"..."}` | by hand (`packages/research/src/restate/enrichment.ts:967`) |
| `wren enrich signals --niche <n> [--collector] [--company] [--person] [--dry]` | from a laptop |
| Console Outbound, Signals (`research.signal`) | reads |
| component `research.signals` | each collector's settings and `on` |

## See

- Source: `packages/research/src/signals/`
- Design: `designs/2026-10-06-signal-collectors.md`

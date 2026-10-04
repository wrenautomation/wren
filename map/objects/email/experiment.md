---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-04 @ fc7250d
entity: packages/channel-email/src/schema.ts:198
---

# experiment

A copy experiment: one template of a niche whose `[[variant]]` points evolve. Each point is a locus, each option an allele, each `template_versions` row it renders a genome (designs/2026-10-04-copy-evolution.md).

## Why this shape

Sends shift toward the options that work without anyone editing a file. The bandit is pure (`@wren/experiments`, no email, no database), so the simulator and the tick share it. An allele is the hash of its option text, so its counts follow the words across versions; the unit is the recipient, and an outcome credits every allele sent before it on that thread (`packages/channel-email/src/evolve/stats.ts:1`).

## Shape

- `experiments`: niche, template, state (`running`, `paused`, `settled`, `stopped`), `live_version` (the genome), `file_version` (the last file imported), settings; one non-stopped row per template (`packages/channel-email/src/schema.ts:198`)
- `experiment_alleles` (`schema.ts:250`), `experiment_snapshots` (shares and P(best) per locus per tick, `schema.ts:284`), `experiment_journal` (every event, `schema.ts:311`)
- `template_versions.parent_version`, `.experiment_id`: a genome's lineage (`schema.ts:234`)
- engine: fitness, pooled Beta prior, P(best) by quadrature, selection, floor, guards, settle (`packages/experiments/src/engine.ts:228`); settings schema (`packages/experiments/src/settings.ts:30`)
- compose and refresh render the genome in place of the file, drawing each locus by the newest snapshot's shares (`packages/channel-email/src/evolve/experiments.ts:560`, `outreach/templates.ts:222`)

Citations: `packages/channel-email/src/evolve/experiments.ts:144`, `:372`, `packages/experiments/src/engine.ts:228`

## Connected to

- **owns:** genome rows in `template_versions`; `provenance.snapshot` on [[email/message]]
- **owned-by:** a niche's template ([[email/template]])
- **joins:** [[email/message]] picks, [[email/thread-event]] outcomes, `call_invites`, [[email/open-event]]
- **looks-like-but-is-not:** `wren email variants` (a read-only report over every version, `report/variants.ts`)

## If you change this

- **Hits:** what compose renders for that template ([[processes/compose]]); the queue refresh; [[processes/evolution]]
- **Does not hit:** templates with no experiment (they render exactly as before); the send gate, caps and kill switch

## Surfaces

| Surface | Role |
|---|---|
| `wren evolve start/status/tick/switch/pause/resume/stop` | operator (`apps/cli/src/evolve.ts`) |
| `wren evolve simulate` | compares selection strategies on synthetic truth (`packages/experiments/src/simulate.ts`) |
| `Evolution/fleet` | ticks daily |
| compose, `QueueRefresh` | read the genome and shares |

## See

- Source: `packages/channel-email/src/evolve/experiments.ts`, `packages/experiments/src/engine.ts`

---
type: process
status: verified
verified: 2026-10-04 @ fc7250d
consumes: ["[[email/experiment]]", "[[email/message]]", "[[email/thread-event]]", "[[email/template]]"]
produces: ["[[email/experiment]]", "[[email/template]]"]
---

# evolution

Once a day each running copy experiment counts what its alleles earned, retires the losers, and resets the shares compose draws by.

## Input → Movement → Output

Sent messages of the template with their picks, their threads' outcomes, and the niche's template file. `Evolution/fleet` at 08:00 (send timezone) imports a file edit, counts per allele, evaluates each locus, retires, snapshots and settles, one transaction per experiment. Output: a snapshot row, journal rows, and on a retirement a new genome version that the niche's queue is re-rendered onto.

## Why this shape

A retired allele must leave the queue too, so a changed genome triggers a stale-only refresh. A retried step must not tick twice, so an experiment snapshotted in the last 20 hours is skipped. An automatic stop (`settled` or `budget`) freezes the genome and its last shares; only `wren evolve stop` hands the template back to the file.

## Steps

1. Running experiments, skipping a recent tick (`packages/channel-email/src/restate/evolution.ts:44`).
2. File import as a `manual` mutation (`packages/channel-email/src/evolve/experiments.ts:217`).
3. Counts (`packages/channel-email/src/evolve/stats.ts:39`), then `evaluateLocus` per locus (`packages/experiments/src/engine.ts:228`).
4. Retire, write the genome without them, snapshot, settle, stop (`experiments.ts:372`).
5. Refresh the niche's queue when a genome changed (`evolution.ts:44`).

## If you change this

- **Hits:** what compose renders for an evolving template; [[email/experiment]]
- **Does not hit:** templates with no experiment; sends (the send loop sends what is queued, under the same gate)

## Surfaces

| Surface | Role |
|---|---|
| `Evolution/fleet` | runs daily |
| `wren evolve tick` | one tick now, by hand |

## See

- Objects: [[email/experiment]], [[email/template]], [[email/message]]
- Source: `packages/channel-email/src/restate/evolution.ts`

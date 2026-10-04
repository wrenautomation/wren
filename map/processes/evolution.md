---
type: process
status: verified
verified: 2026-10-04 @ fc7250d
consumes: ["[[email/experiment]]", "[[email/message]]", "[[email/thread-event]]", "[[email/template]]"]
produces: ["[[email/experiment]]", "[[email/template]]"]
---

# evolution

Once a day each running copy experiment counts what its alleles earned, retires the losers, resets the shares compose draws by, and when due has Cohere write new candidates for William to approve.

## Input → Movement → Output

Sent messages of the template with their picks, their threads' outcomes, and the niche's template file. `Evolution/fleet` at 08:00 (send timezone) imports a file edit, counts per allele, evaluates each locus, retires, snapshots and settles, one transaction per experiment. Output: a snapshot row, journal rows, candidate alleles, and on a retirement or auto-approval a new genome version that the niche's queue is re-rendered onto.

## Why this shape

A retired allele must leave the queue too, so a changed genome triggers a stale-only refresh. A retried step must not tick twice, so an experiment snapshotted in the last 20 hours is skipped. An automatic stop (`settled` or `budget`) freezes the genome and its last shares; only `wren evolve stop` hands the template back to the file.

## Steps

1. Running experiments, skipping a recent tick (`packages/channel-email/src/restate/evolution.ts:55`).
2. File import as an `import` mutation (`packages/channel-email/src/evolve/experiments.ts:127`).
3. Counts (`packages/channel-email/src/evolve/stats.ts:39`), then `evaluateLocus` per locus (`packages/experiments/src/engine.ts:228`).
4. Retire, write the genome without them, snapshot, settle, stop (`experiments.ts:272`).
5. When due (every `strategistEvery` generations or on stagnation), strategist, writer, checker and judge queue candidates, outside the tick's transaction; one failure skips only that experiment (`packages/channel-email/src/evolve/candidates.ts:60`, `:177`).
6. Refresh the niche's queue when a genome changed (`evolution.ts:88`).

## If you change this

- **Hits:** what compose renders for an evolving template; [[email/experiment]]
- **Does not hit:** templates with no experiment; sends (the send loop sends what is queued, under the same gate)

## Surfaces

| Surface | Role |
|---|---|
| `Evolution/fleet` | runs daily |
| `wren evolve tick` | one tick now, by hand; `--write` forces the tiers, `--no-llm` skips them |

## See

- Objects: [[email/experiment]], [[email/template]], [[email/message]]
- Source: `packages/channel-email/src/restate/evolution.ts`, `packages/channel-email/src/evolve/candidates.ts`

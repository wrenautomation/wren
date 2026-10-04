# Copy evolution

Living doc. Started 2026-10-04. William moved it from Later to now on 10-04: build the whole harness before the volume is there. It borrows the useful parts of his older project swarm_rag (typed genomes with lineage, strategy registries picked by name, seeding, convergence checks, three LLM tiers over a deterministic checker, a journal fed back to the writer) and leaves out what email copy doesn't need.

## Why

Today a template's `[[a | b]]` points spread sends evenly by hash, and `wren email variants` reports how each option did. Nothing acts on the report. A losing option keeps its even share until William edits the file, and the edit starts every count over, because counts key on the template version. The harness closes the loop. It moves sends toward the options that win, retires the ones that lose, writes new candidates, and keeps a record of everything it tried.

## Volume

At 10 sends a day from one inbox, telling a 3% reply rate from 5% takes about 1,500 sends per option. The harness runs at any volume. At low volume it mostly explores, and the simulator (E2) is how strategies get compared. Its verdicts wait for the evidence: nothing is retired or settled before its minimum sample.

## Words

- **Experiment.** One template under evolution: niche plus template, like `recruiting` + `book-first/opener`. At most one running per template.
- **Locus.** A variant point. Its key is its name. Today points are auto-named `v1`, `v2` in order, so adding a point renames the ones after it. The parser gains an optional name, `[[#hook a | b]]`: a `#` then a lowercase name, then a space. Starting an experiment writes a name into every unnamed point (`#v1` …), so its loci keep their keys from then on.
- **Allele.** One option at a locus. Its key is the first 12 hex of sha256 over its words, with facts written as `{key}`. The same words are the same allele in any version, so their counts survive edits elsewhere in the file.
- **Genome.** The template's source: the fixed text plus the live alleles at each locus. A genome is a `template_versions` row. That row gains `parent_version` and `experiment_id`, so every version knows where it came from.
- **Share.** A live allele's part of the next sends at its locus.
- **Snapshot.** The stats, shares and P(best) at one tick. Its id is recorded on every message it shaped.

## The unit is the recipient

An allele's exposure is one enrollment that was sent a message carrying it. Success is that enrollment's outcome under the fitness strategy (a reply, an interested reply, a booked call), credited to every allele the recipient was sent before the outcome. Picks are drawn independently per locus, so comparing alleles within one locus stays fair. A reply to a follow-up still credits the opener's subject that got the email opened.

## How a send picks

- `render(tpl, facts, seed, allocation?)`. `allocation` maps a locus name to `{optionIndex: share}`. A rule picker still routes first. Where it would fall back to the hash spread, a locus with shares draws instead: `u = sha256(seed, locus) / 2^256`, walked along the cumulative shares. The same seed and snapshot always give the same pick, so the queue refresh stays stable.
- Shares never live in the template. If they did, every snapshot would make a new version.
- Provenance gains `snapshot` (the snapshot id) next to `picks`.
- Compose reads a running experiment's live genome from `template_versions` (parsed once per version) in place of the file, plus the newest snapshot's shares. A template with no experiment works exactly as today.

## Strategies

Each strategy is a pure function in a registry, picked by name in the experiment's settings. Switching one is a settings change, and the switch is journaled.

**Selection** (turns stats into shares):

| Name | Does |
|---|---|
| `even` | Today's hash spread. |
| `thompson` (default) | Beta posterior per allele. Share = P(best), from 10,000 draws seeded by the snapshot id. This is Thompson sampling for a batch. |
| `epsilon` | ε even, the rest to the current best. |
| `ucb1` | Upper confidence bound. Share goes to the top bound, then the floor. |

Every strategy keeps a floor (default 5%) per live allele, so nothing starves. Priors are pooled: each allele starts at its locus's mean rate, weighted as 50 sends (setting `prior`).

**Fitness** (what counts as a success):

| Name | Success |
|---|---|
| `replies` | Any human reply. |
| `interested` (default) | A reply classified interested or meeting booked. |
| `booked` | A booked call (call invite booked, or a handoff's `meeting_booked_at`). |
| `opens` | A human open. Tracked sends only. A subject locus can use it as an early signal. |
| `weighted` | w₁·replies + w₂·interested + w₃·booked, weights in settings. |
| `lexicographic` | Ranks by interested, then replies, then opens. |

A locus may override the experiment's fitness.

**Guards** apply under any fitness. An allele whose negative-reply rate (the classifier's opt-out and not-interested) runs above twice its locus's rate, after the minimum sample, is retired whatever its fitness. Bounces measure addresses, not copy, so they are not a guard.

**Convergence** (from swarm_rag's detector):

- Retire an allele when P(best) < 2% after at least `minSends` (default 300) exposures.
- A locus is settled when one allele holds P(best) ≥ 95% after `minSends`. It then keeps 90%, and challengers share the rest.
- A locus is stagnant when its best allele hasn't changed in `window` snapshots (default 14) and it isn't settled. Stagnation calls the strategist.
- An experiment stops for a reason from a fixed list: `settled` (every locus), `budget` (`maxAlleles` tried at a locus), `stopped` (by William).

**Mutation** (new alleles):

| Name | Does |
|---|---|
| `rewrite_loser` | The writer rewrites the worst live allele, shown the best ones and the locus's journal. |
| `new_angle` | The writer covers an angle no live allele takes. |
| `crossover` | The writer merges the ideas of the two best alleles. |
| `retire_only` | No new alleles: a plain bandit. |
| `manual` | William adds alleles in the file or the console. |

**Seeding** (generation 0):

| Name | Does |
|---|---|
| `from_template` (default) | The file's current points and options. |
| `llm_seed` | The writer adds N alleles per locus from the copy rules and the offer's facts. |
| `from_winners` | Imports the best alleles of another experiment at loci with the same name. |

## The LLM tiers

From swarm_rag's oracle, advisor and executor, sized down:

1. **Strategist.** Runs every `strategistEvery` snapshots (default 7) or on stagnation. It reads the stats and the journal and returns a mode (`explore`, `exploit`, `diversify`, `fix`), the loci that get new alleles, the mutation to use, and a temperature: how far the writer may stray from the winners. If the model fails, a fallback rule picks the stagnant locus with the widest spread, using `rewrite_loser`.
2. **Writer.** Writes candidate alleles for one locus. Its prompt has the live alleles with their rates, the last 20 journal entries at the locus with their outcomes, and the copy rules.
3. **Checker** (no LLM). It parses each candidate with the template parser (known facts, valid marks, no nesting). It applies the `readable` and copy rules: no em dashes, no prices, length within 1.5× of its siblings. It drops anything whose hash was ever tried at the locus.
4. **Judge.** A cheap model scores each surviving candidate 1 to 10 against the live winners, and tags its angle (curiosity, pain, proof, offer, personal). Only the top `queueSize` (default 3) go to William. `diversify` mode asks for an angle no live allele has. That one tag stands in for swarm_rag's MAP-Elites grid.

Models come from settings as `packages/llm` specs. The defaults spend William's Cohere credits, which he set aside for simple tasks: strategist and writer `cohere:command-a-03-2025`, judge `cohere:command-r7b-12-2024`. Prod already has the Cohere key in SSM.

## Approval

Every candidate lands in the console's Copy candidates queue. William approves, edits then approves, or rejects. An approved candidate goes live in a new genome version. `autoApprove` (default off) skips the queue for one experiment. Copy stays William's call by default, and nothing sends outside the send gate and kill switch.

A genome change does three things: it writes the new source to `template_versions` (with its parent and the journal id that made it), points the experiment at that version, and runs `QueueRefresh` for the niche, so untouched queued drafts re-render.

## The file stays an editor

When the template file's version changes under a running experiment (William edited it, then deployed), the next tick imports it as a `manual` mutation. A point is matched by name, else by sharing an allele. New options go live, dropped options retire, and new points become new loci. Every import is journaled.

## The journal

Every event is one row: start, seed, snapshot, strategist call, candidate, check result, judge score, approve, reject, edit, retire, settle, switch, import, stop. A candidate's row gets its outcome filled in later: exposures, rate, P(best) at retirement or settling. That outcome is what the writer reads next time, swarm_rag's `EvolutionJournal` feedback loop.

## Where it runs

- **`@wren/experiments`** (new foundation package). Selection, fitness, guards, convergence, a seeded RNG, the registries, and the simulator. Pure functions over `{locus, allele, exposures, successes}`. No email, no database.
- **channel-email.** The email binding: the stats query, genomes as template sources, the compose hook, the tiers' prompts, the `Evolution` loop, the records and the CLI.
- **`Evolution`** is a loop on the loop factory. It ticks daily at 08:00 ET, after the night's reply sync. For each running experiment it snapshots, sets shares, checks convergence and guards, and when due runs the strategist, writer, checker and judge, then queues candidates. Every step runs in `ctx.run`.

## Data (migration 0075)

- `experiments`: id, niche, template, state (`running`, `paused`, `settled`, `stopped`), live_version, file_version (the last file version imported), settings jsonb, started_at, stopped_at, stop_reason.
- `experiment_alleles`: experiment_id, locus, allele, text, state (`candidate`, `live`, `retired`, `rejected`), origin (`seed`, `mutation`, `manual`, `import`), journal_id, angle, judge_score, born_version, retired_reason, decided_by, decided_at, created_at.
- `experiment_snapshots`: id, experiment_id, generation, taken_at, stats jsonb (per allele: exposures, successes per fitness, negatives), shares jsonb, p_best jsonb, strategies jsonb.
- `experiment_journal`: id, experiment_id, generation, kind, locus, detail jsonb, outcome jsonb, created_at.
- `template_versions` gains `parent_version` and `experiment_id`, both nullable.

Settings are one zod schema: `selection`, `fitness`, `fitnessByLocus`, `weights`, `guards`, `floor`, `prior`, `minSends`, `window`, `strategistEvery`, `mutation`, `seeding`, `models`, `queueSize`, `maxAlleles`, `autoApprove`. Every field has a default, so `{}` is valid.

## CLI

`wren evolve start <niche> <template> [--selection --fitness --seeding]`, `status [<id>]`, `tick <id>` (one tick, local), `switch <id> <key>=<value>`, `candidates`, `approve <allele> [--text]`, `reject <allele>`, `pause`, `resume`, `stop`, `simulate`.

## Simulator

`wren evolve simulate --selection thompson,epsilon,ucb1,even --loci 3 --alleles 4 --rates 0.01,0.015,0.02,0.03 --per-day 10 --days 365 --runs 200` runs synthetic truth with no database and no LLM. Mutation is simulated by drawing a new allele's true rate from the locus's prior. It prints, per strategy: regret (successes lost against always sending the best), the share of sends that went to the true best, days to settle, and wrong settles. This is how William compares strategies before real volume.

## Console (E4)

In the Outbound app, on the console standard:

- **Experiments** (List over record `email.experiment`). The record panel shows each locus's alleles: share, exposures, rate with its Wilson interval (`rate()`), P(best), state and angle. It also shows the lineage as a React Flow graph (versions, and the alleles each one added or retired), the journal as a timeline, and the settings as a form (the handler forms' `formOf` over the settings schema). Actions: start, pause, resume, stop, switch.
- **Copy candidates** (Queue over record `email.candidate`). The allele's words beside the live winners at its locus, its judge score and angle, and the strategist's reason. Approve, edit, reject. Bulk approve.
- **Variants** stays as it is.

## Phases

### E1. Engine and data

1. `@wren/experiments`: the registries, selection, fitness, guards, convergence, seeded RNG. Tests on synthetic counts.
2. Named loci in the parser (`[[#name …]]`), with allele hashing. Existing templates keep their versions until named.
3. Migration 0075. The stats query (recipient unit, thread credit), parsing each version's source once.
4. `render` allocation, `provenance.snapshot`, compose reading the live genome. A template with no experiment renders byte for byte as before (test).
5. The `Evolution` loop with no LLM: snapshot, shares, retire, settle, file import. CLI `start`, `status`, `tick`, `switch`, `pause`, `resume`, `stop`.

### E2. Simulator

`wren evolve simulate`, with a test that `thompson` beats `even` on regret over fixed seeds.

### E3. LLM tiers

Strategist, writer, checker and judge, journal-fed prompts, candidates, approve and reject, the genome change with `QueueRefresh`, and `llm_seed` and `from_winners` seeding. Tests use the fake LLM. One live check: a Cohere tick on a test experiment writes candidates into the queue. Nothing is approved and nothing is sent.

### E4. Console

Experiments, Copy candidates, lineage and journal, settings form. Screenshots at 1360 and 390 as the operator.

## Done when

- Recruiting `book-first/opener` runs as an experiment on prod with `thompson` and `interested`, seeded from its current options.
- A Cohere-written candidate waits in the queue, and approving one on a test experiment makes a new version that the queue refresh picks up.
- The simulator compares the four selection strategies.
- A template with no experiment renders exactly as before.
- Gates pass. Nothing sends beyond the existing gate, caps and kill switch.

## Risks

- **Too little volume.** With pooled priors and a floor, it stays close to even until the data says otherwise. That is correct behavior, not a bug.
- **Shares change between compose and send.** Each message records its snapshot, and stats count what was sent.
- **Model copy drifts from William's voice.** He approves by default, the checker enforces the rules, and the lineage shows where each allele came from.
- **A file edit and a candidate both change a locus.** The import runs first in the tick, and candidates are written against the result.

## Decision log

- 2026-10-04: Written. William moved copy experiments, and the evolutionary harness with them, from Later to now. Kept from swarm_rag: typed genome with lineage, strategy registries, seeding strategies, convergence and termination reasons, three LLM tiers over a deterministic checker, a journal with outcomes fed back to the writer, a simulator. Left out: the MAP-Elites grid (one angle tag covers diversify), self-adaptive sigmas (the strategist's temperature covers it), checkpoint files (Restate's journal and the snapshot rows cover them).
- 2026-10-04: The recipient is the unit, and an outcome credits every allele the recipient was sent. A reply to the follow-up still says something about the opener's subject.
- 2026-10-04: Shares live outside the template, so a snapshot never makes a new version. Allele keys hash the words, so counts survive edits to other loci.
- 2026-10-04: Cohere runs the default models: William named it for simple tasks, and the prod Lambda can't run the free claude-code path.
- 2026-10-04 (E1): Defaults the doc left open: epsilon 0.1; `weighted` fitness weights reply 1, interested 2, booked 4, divided by their sum; `lexicographic` scores by the first of interested, replies, opens that the locus has any of; `maxAlleles` 12; `guards` is `{negativeRatio}`. P(best) is grid quadrature over the Beta posteriors, not seeded draws, so a tick is exact and repeatable.
- 2026-10-04 (E1): Outcomes. Booked is a booked call invite or a `meeting_booked` disposition; reactivation handoffs stay out (channel-email can't import a product). Negatives are `not_interested`, unsubscribes and complaints. Sends made before the experiment started count when they carry the same option text: the allele is the words.
- 2026-10-04 (E1): An automatic stop (`settled` or `budget`) sets state `settled`: the genome and its last shares keep rendering. Only `wren evolve stop` sets `stopped` and hands the template back to the file. `resume` works from paused or settled. `budget` fires when every unsettled locus is spent.
- 2026-10-04 (E1): Start writes a genome with every point named. Picks don't move: unnamed points were already auto-named `v1..vN` by position, and a pinned digest test guards render byte for byte. `[[#` at the start of a point is reserved for the name.
- 2026-10-04 (E1): File import. A point matches by name, else by a shared option, else becomes a new locus. New options go live with origin `import` (the doc said `manual`; `import` tells the two apart). Options dropped from the file retire. An option the engine retired stays retired unless the file brings it back as new text.
- 2026-10-04 (E1): Compose and the queue refresh read the genome through one overlay (`experimentTemplates`). A tick that changes a genome refreshes that niche's queue at once, so no draft keeps a retired allele. The loop skips an experiment ticked in the last 20 hours, so a retried step can't tick twice. One non-stopped experiment per template is a partial unique index.
- 2026-10-04 (E1): `Evolution/fleet` binds always and idles with nothing running; it starts by hand like the other fleet loops. `wren evolve tick` runs locally and prints a reminder to refresh the queue.
- 2026-10-04 (E1): The migration is 0075 (`copy_experiments`): unit economics took 0073 and the client look 0074. `template_versions.experiment_id` gets a partial index, since every foreign key is indexed.
- 2026-10-04 (E2): The simulator ticks daily like the loop. A recipient succeeds with the mean of its picked alleles' true rates, and one outcome credits every allele, as on real threads. Each run deals the rates to each locus in a shuffled order, the same truth for every strategy. A retired allele is replaced the same day by one whose rate is drawn from Beta(prior × mean rate, prior × (1 − mean rate)), up to `maxAlleles`; `retire_only` and `manual` replace nothing. Regret is expected, not sampled: the best rate present at each locus minus the picked one, summed per recipient. First run (3 loci × 4 alleles, 10 a day, 200 days): `epsilon` and `thompson` lose about 20 to 30% fewer successes than `even`; `ucb1` stays near `even`, since its bound is wide against rates near 2%.
- 2026-10-04 (E2): The migration became 0075: the client look took 0074 on main first. Regenerated with drizzle-kit, same SQL.

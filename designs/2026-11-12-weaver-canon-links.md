# Weaver ↔ Canon links (2026-11-12, WA-1339)

## Goal

A weaver run can start from a chosen part of Canon and give results back to the rule lines it touched. Runs stay free-standing: with no seed, `weaver plan` works as today.

William's direction (11-12, via the WA-1339 notes):
- In: a topic's references, its rule lines as claims to test, `notes.md` as the lens, its agent-only lines as questions.
- Out: picked pages as proposed references; a link from each finding to the line it backs; contradictions as conflicts. All else stays in the ledger.
- Grain: choose exactly what seeds a run and what comes back. Any of: one record, a set, line ids or ranges; by type (references, rules, notes, conflicts, audit gaps), by tag, by provider, by run.
- Starting points: a topic, a set, a reference, a skill, a conflict, a past run.

Terms. A *rule line* is one line of a rule set in `canon/rules/<topic>/*.md`, written `- **AR-1** text [n]`. Its id is unique across Canon: lint keeps each prefix in one set (`knowledge/src/lint.ts:38-39`). *Backing* is what `knowledge audit` says stands behind a line: human, agent, unknown or none, from the providers of the sources its `[n]` refs cite (`knowledge/src/provenance.ts:38-65`). A *weak line* has backing agent or none. Today: 505 agent, 130 none, 0 unknown (`knowledge audit`, 2026-11-12).

## Today (code facts; engine paths under `engine/packages/`)

- A run starts with `weaver plan [ask]`; `--run` opens its next round, `--parent` makes a child run (`weaver/src/app/engine-cli.ts:592-615`). Each round writes a snapshot record (`weaver/src/ledger/records.ts:194`).
- `weaver reference <run> --tag|--id` seeds from Canon sources (`engine-cli.ts:857`). Nothing seeds from rule lines, notes, conflicts or audit gaps.
- The brief lists reference tags, but hides a tag with more than `REFERENCE_MAX` (30) records (`weaver/src/engine/agent.ts:875,1702`). 120 sources carry `reference` today, so that tag is already hidden.
- `weaver promote` makes a Canon source only from a page with a kept finding (`weaver/src/engine/promote.ts:216`), with provider weaver (`promote.ts:281`). A finding already in Canon is never edited (`promote.ts:206`).
- A conflict means a human source against an agent source or rule (`knowledge/src/records.ts:133-135`). States: open, deferred, resolved. Each open one prints in every render of its topic with "the human source wins" (`knowledge/src/render.ts:57,70`).
- `knowledge find` searches Canon by words, type, topic, tag (`knowledge/src/cli.ts:193`). `knowledge render <ids> --only|--except AR-1..AR-9` renders sets by line range (`cli.ts:177`, `render.ts:105`).

## The fixed parts (all options share these)

1. **Seed lands on the snapshot.** The plan resolves the seed once into record ids with their versions, plus line ids with their backing. The snapshot keeps the spec and that list. Later rounds and child runs copy it. A run is reproducible: it shows what Canon said when it started.
2. **The brief gets a seed block.** It is lean, with ids and counts and no bodies. It holds the guide id, one count line per set, `none` line ids, then agent-only ids, open conflicts, the reference count, and notes by id. Text comes from `knowledge render`. Cap: 60 line ids; the rest are counts per set.
3. **Links ride the keep call.** `weaver add call <run> <finding> keep --backs|--contradicts <line id...> --why`. The agent decides, next to the quote (10-28 rule: `designs/2026-10-26-research-engine.md`). The engine checks that each id is a live line. The latest call wins, so a dropped finding drops its links.
4. **Picks are records.** `weaver add pick <run> <document> --why` proposes a page as a reference. Promote makes a source for it even with no kept finding.
5. **Promote writes it back.**
   - A Canon finding gets `backs` and `contradicts`. On a finding already in Canon, promote edits these fields.
   - A picked page's source gets tags `proposed-reference` and the topic. William's accept turns that into `reference` (`knowledge edit`).
   - A contradiction makes a conflict record with the new state `proposed`. Render skips `proposed`, so it never reaches a skill. William opens or drops it. Promote keys on the line id: it writes one proposed conflict per line and adds each new contradicting finding to its `cites`.
6. **Links are evidence, not backing.** A weaver source is agent-made. So a link moves no line to human. `audit` and `render` show "N weaver findings back, M contradict" per line. Turning that into a cite stays the `sop-making` job.

## The open choice: how a run names what it takes and gives

### S1. One flag per facet

`weaver plan --topic ui-design --type rules,gaps --lines AR-1..AR-9 --provider human --give links,picks`.

- For: easy to read; commander validates each flag.
- Against: about 12 flags on `plan`, and `reference` or `knowledge render` cannot reuse them. AND/OR and exclusion need more flags (`--not-type`). Each new facet is a new flag in two CLIs.

### S2. One selector grammar, owned by knowledge (recommended)

A short query string. Knowledge parses it, and every command that picks records reuses it.

```
weaver plan "ask" --seed "topic:ui-design type:rules,gaps backing:none" --give "links picks conflicts"
weaver plan "ask" --seed "set:ui-design-art lines:AR-1..AR-9"
weaver plan "ask" --seed "conflict:conflict-landing-headline-prompt-not-x-but-y"
weaver plan "ask" --seed "run:01M76HZG type:findings provider:human"
knowledge render --seed "topic:app-design type:rules -lines:NA-3"
```

- Starting points (`from` atoms): `topic:`, `set:`, `source:` (one reference), `skill:` (= the topic's guide plus the sets it cites), `conflict:` (its lines plus cites), `run:` (the sources and findings that run made).
- Filters: `type:` (references, rules, notes, conflicts, gaps, findings), `lines:` (ids and ranges, today's syntax), `tag:`, `provider:` (human, agent, weaver, or a who), `backing:`.
- Rules: keys combine with AND, a comma is OR, and a leading `-` excludes. One function: `select(root, spec) → { records: {id, version}[], lines: {id, backing}[] }` in `knowledge/src/select.ts`.
- `--give` picks what comes back: `links` (`links:seeded` keeps only links to seeded lines), `picks`, `conflicts`. Default: all three when a seed is given. The ledger keeps everything; `--give` only gates promote.
- For: one grammar for weaver, render, find and audit. A new facet is one atom. A seed is a string that fits in a snapshot, a task note or a skill.
- Against: a small parser to keep, and bad atoms need clear errors. A typo must fail, never match nothing.

### S3. Saved lenses in Canon

`canon/lenses/<name>.json` holds `{seed, give, why}`, versioned like any record. `weaver plan --lens ui-gaps`.

- For: named and reviewed; a skill can ship its lens.
- Against: a file for every one-off seed. It still needs S1 or S2 inside the file. Add it later on top of S2 if the same seeds repeat.

### S4. Two-step pack

`knowledge pack <spec> --out seed.json` freezes the ids; then `weaver plan --pack seed.json`.

- For: you see the seed before the run.
- Against: an extra step and a file per run. Fixed part 1 already freezes the seed on the snapshot, and `knowledge select <spec>` can preview it.

### Ranking

1. One grammar for every command that picks Canon records. S2 is the only option that gives it.
2. Any grain without new code per facet. S2 adds an atom; S1 adds a flag in two CLIs.
3. Reproducible runs. All four meet it through fixed part 1.
4. Low ceremony for one-off seeds. S3 and S4 lose here.

**Recommend S2**, with S3 as a later layer.

## Rejected earlier shapes

- Canon-side links only, made after the run: the agent that read the page is gone, so most links are never made.
- The engine scores every finding against every line with a model: the agent should decide (10-28 rule), and cost grows with findings × lines.
- One run per weak line: 635 small runs that read the same pages again.
- `weaver recall --canon`: promoted findings are already in the ledger that recall indexes. Rule lines come with the seed. Human sources are in `knowledge find`.
- Auto-open conflicts: they would reach every skill render with no human side. `proposed` keeps them for William.

## Build (engine, then canon, then wren pin)

- `knowledge/src/select.ts` (new): the grammar, `select()`, and tests per atom and for a typo error. CLI: `knowledge select <spec>`, plus `--seed` on render and audit.
- `knowledge/src/records.ts`: Finding `backs?`, `contradicts?` (line ids); conflict state `proposed`. `render.ts` skips `proposed`. `provenance.ts`: `audit` adds the link counts per line and leaves backing as is.
- `weaver/src/ledger/records.ts`: snapshot `seed?: {spec, give, records, lines}`; call `backs?`, `contradicts?`; new `pick` record.
- `weaver/src/app/engine-cli.ts`: `plan --seed --give`; `add call --backs --contradicts`; `add pick`.
- `weaver/src/engine/agent.ts`: the seed block in the brief. `promote.ts`: link fields, edits to existing findings, picks, proposed conflicts, gated by `give`.
- `weaver` SKILL.md: when to seed, link and pick.
- Tests: a synthetic Canon in a temp dir. Plan → link → promote gives the fields, one proposed conflict per line, and a pick source. A second promote adds a late link.
- Release: engine `pnpm release`, then the wren pin bump.

## Non-goals

- No change to a rule line by a run. Proposed conflicts and link counts inform `sop-making`.
- No change to how a run picks queries. The seed informs; it does not steer.
- No backfill of links on old ledgers.

## Risks

- Seed drift: Canon changes mid-run. The snapshot keeps versions, and the brief marks a seeded record that changed since.
- A line renamed after a link: line ids are fixed by convention ("never renumber" in each set). Promote skips a link to a dead id and reports it.
- Proposed-conflict pile-up: one per line, with cites added. `knowledge conflicts --proposed` lists them.
- `reference` tag hidden by the brief cap: picks use `proposed-reference` plus the topic. The seed block counts references per topic, not the global tag.

## Decision log

- 2026-11-12: first draft (options: topic + agent links, Canon-side, engine tests rules, one run per line).
- 2026-11-12: goldfish review: 43 findings across 3 reviewers. Applied: `plan` not `new`, picks reach Canon, links are evidence not backing, links on the keep call, edits to existing findings, recall cut, stale cites and counts. Rejected: auto-open conflicts (replaced by state `proposed`), dropping picks (William asked for proposed references). Then rewritten around William's grain ask: the selector is the open choice. Open for William: S2; conflict state `proposed` vs no conflicts in v1; `proposed-reference` tag vs auto-reference on linked pages.
- 2026-11-12: William: conflicts as state `proposed` (A); picks tagged `proposed-reference`, his accept makes `reference` (A). Selector: S2 (recommended; he did not object).
- 2026-11-12: built in engine 0.73.0 (363d851): knowledge `select`, `render|audit --seed`; weaver `plan --seed --give`, `add call --backs|--contradicts`, `add pick`, brief `seed`; promote writes links (late ones as edits), picks and one proposed conflict per line. `render` shows no link counts; `audit` and `select` do. No layers part for seed lines: the brief `seed` view covers it. wren pins 0.73.0.

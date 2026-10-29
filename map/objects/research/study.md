---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-26 @ HEAD
entity: packages/research/src/schema.ts:701
---

# study

One research question answered from the open web: angles, the pages read, claims with quotes, and drafts (offers, emails) that cite the claims. Tables `studies` and `study_steps`; the claims are `fact` findings ([[learn/breakdown]] for the other kind). `packages/research/src/studies/`, CLI `wren study` (`apps/cli/src/study.ts`), skill `.claude/skills/research`. Design `designs/2026-10-25-ingestion-engine.md`, phase 2.

## Why this shape

A study is a content line (`designs/2026-10-25-ingestion-engine.md`): find (plan, search, ask, read), extract (claims), call (his keep, tune, drop), synthesis (report and drafts). `study_steps` is the find checkpoint: one row per unit (`plan` an angle, `search` a query, `ask` an angle, `read` a URL, `claims` a URL, `draft` a kind), outcome `ok | empty | refused | failed`; a re-run does only what is not done and tries `failed` again. Claims live as findings so his calls use the same `decision_calls` kind `finding` as every other finding, and so a find station on Wren's map that names the study (`study: <slug>`) takes its pages ([[platform/journey]], document instances).

## Shape

- `studies` (`schema.ts:701`): `slug` (unique, `STUDY_SLUG`), `question`, `angles` jsonb (strings), `drafts` jsonb (`{key, ask}`), `niche`, `created_at`.
- `study_steps` (`schema.ts:738`): `study_id`, `step` (`STUDY_STEPS`), `key` (the unit), `outcome`, `detail` jsonb, `document_id` (a read's page, or the page a `claims` row read), unique `(study_id, step, key)`.
- A claim: finding `kind` `fact`, `fact_key` `doc:<document>/study:<slug>/<sha256(quote)[0:12]>` (`claimKey`, `run.ts`), `value` `{claim, angle}` (angle an index), `question` `angle/<i>`, `proof` `{quote}`, `via` `study`, `by` `model`, `confidence` 1. Upsert on the key: the same quote read again is the same finding.
- A `claims` row's detail: `{kept, dropped: [{claim, why}], envelope}`. A `draft` row's detail: `{kept, dropped, basis}`; `basis` hashes the numbers and keys of the claims he had not dropped when it was drawn.

## Behaviour

- `runStudy` (`run.ts`): plan → search (+ `ask` with `--ask`) → read (`pickReads`) → claims per ok read page in id order (`pageEvidence` picks 12k chars of passages for every angle; `buildClaimsPrompt`, `gateClaims`: angle index, quote on the page, numbers in the quote; `keepClaims` writes the findings) → drafts once no angle is pending and every ok read has its claims (`studyClaims` minus his drops; redrawn when `basis` differs). The pure parts (query plan, evidence, claim gate, drafts, report) are `@wrenautomation/read/study`; `run.ts` keeps the search, the DB and the loop.
- `--redo <step>` deletes that step and later ones, and (`dropUncalledClaims`) the study's claims with no call. `addStudyPage` adds a held page as a read; the next run claims from it and redraws the drafts.
- `studyClaims` numbers every claim 1.. in report order (angle, page read order, finding id) with his newest call. `callStudyClaims` (`wren study call <slug> keep|tune|drop <n...> [--why]`) records one call per number; `tune` needs words. `studyView` + `studyReport` (`report.ts`): claims with `[n]` and his call, a dropped one struck, a stale draft marked, gate drops and pages waiting in the counts.
- On a line (`packages/pipeline/src/lines.ts`): a read ok page is found; extract ends with the page's final `claims` row; call ends when every claim on the page has his call or he called the page (`doc:<id>`).

## Connected to

- [[platform/journey]] (document instances, `linePass`), [[platform/executor]] (`trigger.found {study}`), [[learn/breakdown]] (the other `fact` findings; `calls.md` reads `finding` calls), [[research/document]] (the pages).

## If you change this

- The key format: `dropUncalledClaims`, `studyClaims` and `lines.ts` (`ended`) match on `doc:%/study:<slug>/%`; an SOP line's extract excludes `doc:%/study:%`.
- A new step: `STUDY_STEPS` enum (migration), `runStudy`'s order, and `--redo`'s "later" list.
- The find station's fields (`sop`, `study`): `metro.ts` and `checkEntry` on the map side, and `logicProblems` for `trigger.found` in `packages/core/src/logic.ts`, or the executor leaves the whole workflow out (`soundShapes`). Test both.

## Surfaces

| Surface | Use |
|---|---|
| `wren study new|run|report|call|add-page|list` | writes, main database only |
| `wren learn call` / the item page | the same `finding` calls, by key |

Citations: `packages/research/src/schema.ts:701`, `packages/research/src/schema.ts:738`, `packages/research/src/studies/run.ts`, read `src/study/` (`claims.ts`, `evidence.ts`, `drafts.ts`, `report.ts`), `packages/pipeline/src/lines.ts`, `apps/cli/src/study.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-16 (decide build, be8fc8d4)
entity: packages/core/src/decide-schema.ts:34
---

# decide (the machine's call beside William's)

One seam for every yes/no-shaped machine call: `decide()` asks a backend (Jev now, the gateway when Jev is down, Laya later) about one subject and keeps the whole answer; William's own call on the same subject is kept beside it. The pairs are the distill set for Laya. Kinds today: `comment_quality` (Send, Edit, Drop on a drafted comment) and `learn_worth` (Worth it, Skip on a Learn item).

## Why this shape

2026-10-16 (`designs/2026-10-16-decide.md`): a human call always wins, and his going against the machine is the signal. Each kind has a mode: off, shadow (asked, logged, never shown), recommend (shown on the lists), gate (filters; refused until a kind has a gate filter built, and only on his yes once agreement is ≥95% over ≥200 of his calls). Jev and Laya share the `/v1/systemone` shape through `@typesafe-ai/sdk` 0.6.0 (exact pin: no zstd, so Laya can serve it).

## Shape

- Tables (`packages/core/src/decide-schema.ts`, migrations 0284, 0285): `decisions` (`:34`: kind, subject, mode, backend, model, state, questions, answers, label, p (chance kept), confidence, tokens, `cost_usd`, `latency_ms`, error, `ref` unique `<kind>:<subject>:<backend>:<sha256 16>` so a question is bought once) and `decision_calls` (`:79`: his label, keep, source, by, `decision_id` (newest decision at or before), agreed, override (disagreed with a pick he was shown), `ref` unique)
- Kinds `packages/core/src/decide/kinds.ts:91` (`KINDS`, one choice question under `PICK`, labels with keep side, `GATE_AT` `:127`)
- Backends `packages/core/src/decide/backends.ts`: `jevBackend` `:64` (20 s, one retry), `gatewayBackend` `:134` (JSON from `@wren/llm`, shaped like Jev), `failureOf` `:55` (refused input → error row; refused key → `DecideStop`; else next backend), `backendsFromEnv` `:189` (`WREN_DECIDE` jev|jev:<model>|laya:<model> + `WREN_DECIDE_URL`|gateway[:model]|off; key `TYPESAFE_API_KEY`). Jev costs $0.042 per 1M input tokens, output free
- Seam `packages/core/src/decide/decide.ts`: settings block `decide` (`:29`, per-kind mode, `dailyUsd` default $1), `decide` `:104`, `setDecideMode` `:54`, `picksOf` `:208` (newest pick per subject, empty unless recommend or gate), `pickStates` `:234`
- His calls: `recordCall` `packages/core/src/decide/calls.ts:40`; comments from the draft record (`recordCommentCall` `packages/core/src/decide/comments.ts:42`, hooked at `packages/core/src/draft-record.ts:135`: a send by him or Claude is send or edit, his reject is drop; a `via: wren` scheduler send is not his); Learn from `mark` (`packages/learn/src/drive.ts:565` → `learnMarkCalls` `packages/learn/src/decide.ts:96`: star, pin worth; archive alone skip), `saveLink` and `askSop` (`learnWorthCall` `:132`). Wren's workspace only
- Sources and loop: `commentSource` (`packages/outreach/src/decide.ts:117`, open drafts' newest model draft, no names), `learnSource` (`packages/learn/src/decide.ts:83`, scored in 3 days, state carries `WREN_FOCUS`), `decidePass` `packages/core/src/decide/loop.ts:52` (40 subjects, 5 min, 3 failures stop, daily cap), `makeDecide` `:139` → loop object `Decide/wren` every 10 min, wired `apps/worker/src/services.ts:2325`
- Numbers `decideStats` `packages/core/src/decide/stats.ts:41`; distill export `decisionRecords` (`wren.decision/1`) `packages/core/src/decide/export.ts:35`
- Console: `ConsolePortal.decisions` (`packages/core/src/console.ts:2652`, `wren:read`) → Agents page Decisions table (`apps/portal/web/src/modules/wren/decisions.tsx`); column Suggests on To approve, Engage and the Inbox (`withPicks`, `packages/content/src/social/records.ts:340`); Worth it/Skip badge on Learn cards (`withLearnPicks` `packages/learn/src/decide.ts:209`, `PickBadge` in `apps/portal/web/src/modules/learn/kinds.tsx`)
- CLI `wren decide stats|mode|export|backfill [--dry-run] [--sample n --max-usd 2]|pass` (`apps/cli/src/decide.ts`)

## Connected to

- **joins:** [[content/draft-event]] (comment calls come off it), [[learn/item]] (marks, saves, SOP adds), [[platform/llm-client]] (the gateway fallback), [[platform/settings]] (the `decide` block), [[platform/loop-object]] (`Decide`)
- **looks-like-but-is-not:** Learn's `score` and `verdict` (the scorer's 0-10 against SOPs; `learn_worth` is a separate call logged against his marks); [[platform/checks]] (holds on bad units, not a model's pick)

## If you change this

- A new kind: add it to `DECISION_KINDS` (migration), `KINDS`, a source and a call hook; its mode defaults from `KINDS`
- A new send or mark path a person uses must write a call (`recordCall`), or agreement undercounts
- Gate filters are not built: `gate` is refused for every kind
- Not covered: client workspaces; a reject then send in one round keeps the first call

## Surfaces

| Surface | Role |
|---|---|
| `Decide/wren` loop | writes `decisions` |
| draft record, Learn marks | write `decision_calls` |
| Agents page, Marketing lists, Learn cards | read |
| Money → Model usage and the Money overview's Model cost tile | read (`email_model_records`, `llm_usage_by_month` union `decisions` as kind `decide:<kind>`, provider = backend, `usd` = sum of `cost_usd`; email's own calls show 0) |
| `wren decide` | reads, sets modes, backfills, exports |

## See

- Design: `designs/2026-10-16-decide.md`
- Source: `packages/core/src/decide/`

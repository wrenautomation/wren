---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-04 (judge build, on 3414da6b)
entity: packages/core/src/decide-schema.ts:34
---

# decide (the machine's call beside William's)

One seam for every yes/no-shaped machine call: `decide()` asks a backend (the judge agent for `comment_quality` and `lead_fit`; Jev, the gateway when Jev is down, or Laya for the rest) about one subject and keeps the whole answer; William's own call on the same subject is kept beside it. The pairs are the distill set for Laya. Kinds today: `comment_quality` (Send, Edit, Drop on a drafted comment), `document` (Keep, Tune, Drop on a document, `doc:<id>`; the machine says Keep or Drop), `lead_fit` (Lead, Unsure, Not a lead on a profile) and `finding` (Keep, Tune, Drop on one fact of a breakdown, subject = the finding's key; his only, mode `off`; his piece calls now live in Canon as verdicts, [[content/standard]], with his words in `decision_calls.comment`).

## Why this shape

2026-10-16 (`designs/2026-10-16-decide.md`): a human call always wins, and his going against the machine is the signal. Each kind has a mode: off, shadow (asked, logged, never shown), recommend (shown on the lists), gate (filters; refused until a kind has a gate filter built, and only on his yes once agreement is ≥95% over ≥200 of his calls). Jev and Laya share the `/v1/systemone` shape through `@typesafe-ai/sdk` 0.6.0 (exact pin: no zstd, so Laya can serve it). 2026-11-04 (`designs/2026-11-04-loops.md`): the judge agent replaced Jev for comments and lead fits; Jev keeps a slot for profiling and segmentation trials.

## Shape

- Tables (`packages/core/src/decide-schema.ts`, migrations 0284, 0285): `decisions` (`:34`: kind, subject, mode, backend, model, state, questions, answers, label, p (chance kept), confidence, tokens, `cost_usd`, `latency_ms`, error, `ref` unique `<kind>:<subject>:<backend>:<sha256 16>` so a question is bought once) and `decision_calls` (`:79`: his label, keep, source, by, `decision_id` (newest decision at or before), agreed, override (disagreed with a pick he was shown), `ref` unique)
- Kinds `packages/core/src/decide/kinds.ts` (`KINDS`, one choice question under `PICK`, labels with keep side, `judge` `:38` = `agent` or `model`, `GATE_AT`)
- Backends `packages/core/src/decide/backends.ts`: `jevBackend` `:68` (20 s, one retry), `gatewayBackend` `:175` (JSON from `@wren/llm`, shaped like Jev), `agentBackend` `:229` (Claude Code `sonnet` on the desk, $0; each answer adds `why` and `agent` = the session id, `claude --resume <id>`; idempotency key = hash of the question), `failureOf` `:59` (refused input → error row; refused key → `DecideStop`; else next backend), `chainFor` `:275` (an `agent` kind goes to the agent only, never the model chain), `backendsFromEnv` `:284` (`WREN_DECIDE` jev|jev:<model>|laya:<model> + `WREN_DECIDE_URL`|gateway[:model]|off, off stops the agent too; key `TYPESAFE_API_KEY`). Jev costs $0.042 per 1M input tokens, output free
- Desk line `packages/core/src/decide/desk.ts` (`deskJudge`): the desk's `claude/ask` through Restate's ingress, 90 s a call; while the Mac is off the call waits in Restate and the next pass, same key, gets the answer
- Seam `packages/core/src/decide/decide.ts`: settings block `decide` (`:29`, per-kind mode, `dailyUsd` default $1), `decide` `:104`, `setDecideMode` `:54`, `picksOf` `:208` (newest pick per subject, empty unless recommend or gate), `pickStates` `:234`
- His calls: `recordCall` `packages/core/src/decide/calls.ts:40`; comments from the draft record (`recordCommentCall` `packages/core/src/decide/comments.ts:42`, hooked at `packages/core/src/draft-record.ts:135`: a send by him or Claude is send or edit, his reject is drop; a `via: wren` scheduler send is not his). Wren's workspace only
- Sources and loop: `commentSource` (`packages/starling/outbound/src/decide.ts:117`, open drafts' newest model draft, no names), `decidePass` `packages/core/src/decide/loop.ts:57` (40 subjects, 5 min, 3 failures stop, daily cap; a kind with no backend waits), `makeNextStepDecide` `:208` → loop object `NextStepDecide/wren` (was `Judge`, before that `Decide`; renamed at its pg move, WA-1219) every 10 min, wired `apps/worker/src/services/platform.ts:73`
- Numbers `decideStats` `packages/core/src/decide/stats.ts:41`; distill export `decisionRecords` (`wren.decision/1`) `packages/core/src/decide/export.ts:35`
- Console: `ConsolePortal.decisions` (`packages/core/src/console/console-portal.ts:79`, `wren:read`) → Agents page Decisions table (`apps/portal/web/src/modules/wren/decisions.tsx`); column Suggests on To approve, Engage and the Inbox (`withPicks`, `packages/starling/inbound/src/social/records.ts:340`)
- Lead check `packages/core/src/decide/lead-fit.ts`: `leadFitState` (what Jev sees: person, touches, `found`, offers; no name, handle, address, phone or link, `scrubText`), `leadFitSource` (Wren profiles with a `theirs` touch newer than their newest `lead_fit` decision, oldest first; offers passed in from `@wren/offers` `leadOffers()` at `apps/worker/src/services.ts`), `leadFitView` (chip data: pick, percent, the judge's why, else a line built by code, his call and `overrode`), `foundFor` (the only reader of `profile_findings`). `NextStepDecide/wren` `one({kind, subject})` (`decideOne`, `loop.ts`) asks one subject now, same cap and backends, exclusive on the key; a `shadow` kind is raised to `recommend` for an explicit ask, `off` refuses. People console `leadCheck` sends to it, `leadFit`/`leadNot` write his call (`leadCall`: `recordCall` source `profile`, plus trait `lead` or `not_lead`, source `william`). See [[leads/profile]]
- CLI `wren judge` (alias `decide`) `stats|mode|export|backfill [--dry-run] [--sample n --max-usd 2]|pass [--kind comment_quality|document|lead_fit]` (`apps/cli/src/decide.ts`)

## Connected to

- **joins:** [[content/draft-event]] (comment calls come off it), [[platform/llm-client]] (the gateway fallback), [[platform/settings]] (the `decide` block), [[platform/loop-object]] (`Judge`)
- **looks-like-but-is-not:** [[platform/checks]] (holds on bad units, not a model's pick)

## If you change this

- A new kind: add it to `DECISION_KINDS` (migration), `KINDS`, a source and a call hook; its mode defaults from `KINDS`
- A new send or mark path a person uses must write a call (`recordCall`), or agreement undercounts
- Gate filters are not built: `gate` is refused for every kind
- Not covered: client workspaces; a reject then send in one round keeps the first call

## Surfaces

| Surface | Role |
|---|---|
| `NextStepDecide/wren` loop | writes `decisions` |
| draft record | write `decision_calls` |
| Agents page, Marketing lists | read |
| Money → Model usage and the Money overview's Model cost tile | read (`email_model_records`, `llm_usage_by_month` union `decisions` as kind `decide:<kind>`, provider = backend, `usd` = sum of `cost_usd`; email's own calls show 0) |
| `wren judge` | reads, sets modes, backfills, exports |

## See

- Design: `designs/2026-10-16-decide.md`, `designs/2026-11-04-loops.md` (Judge)
- Source: `packages/core/src/decide/`

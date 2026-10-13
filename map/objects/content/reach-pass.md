---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-13 (passes.test.ts)
entity: packages/outreach/src/schema.ts:649
---

# reach-pass (people he's done with: never proposed again)

A person he passed on from Engage or Explore: not a lead, not worth a reply, spam, a competitor, rude, or not now. Their open comments, posts and threads close at once, and what the reads find from them later lands closed, so nothing of theirs is drafted again.

## Why this shape

William, 2026-10-13: "a big rejection functionality ... some of these i dont want to / would not be good leads, we would need to cycle them out". Skip and Drop close one row and say why the words were wrong; a pass is about the person. One table keyed by platform and handle, read at intake by every reply queue, so no read path needs its own block list. Kept apart from `suppressions` (core): those are opt-outs and bounces for sends; a pass only stops proposals.

## Shape

- Table `reach_passes` (migration 0238): one row per (`platform`, `handle`); `handle` is `passKey` (handle, else name, lowercased, no @); `name` as the row showed it; `reason` one of `PASS_REASONS` (`packages/core/src/pass-reasons.ts`); `note`; `item` the typed id he passed from; `by`; `until` (not now: 30 days, else null = for good); `lifted_at`. A second pass on the same person updates the row and clears the lift
- Code `packages/outreach/src/passes.ts`: `passOn` (the picked row closes through `dropComment`/`skipPost`/`skipThread` with the note "<reason label>: <note>", so a draft is kept as turned down; a DM is marked read; then `closeOpen` closes their comments (`dropped`), posts (`skipped`, `state_reason` "passed: …") and threads (`skipped`)), `passedOn` (active keys per platform), `liftPass`, `listPasses`
- Intake: `keepComments` (dropped, why "You passed on them", not returned for drafting), `keepPosts` (`dropped`, "you passed on them"), `keepThreads` (`dropped`, same)
- Desk: `ReachDesk.passOn {ids, reason, note}`, `liftPass {platform, handle}`, `passes`
- Console: action `marketing.pass` "Pass on them" (key x, bulk, reason form) on `marketing.engage` and `marketing.explore`
- CLI `wren reach passes` | `passes add <ids...> --reason <r> [--note]` | `passes lift <platform> <handle>`

## Connected to

- **joins:** [[content/reach-post]], [[content/comment]], [[content/draft-event]] (the picked row's draft, rejected with the pass note)
- **looks-like-but-is-not:** suppressions (core opt-outs for sends)

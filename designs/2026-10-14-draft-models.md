# Draft models: which model writes reach drafts, and an A/B

2026-10-14. William: "can we use gemini by default first? or run some A/B testing. i think the
cohere generated ones are ok but not amazing."

## What

Reach drafts (thread replies, comments on others' posts, comment answers, DMs, invite notes) have
their own model setting, apart from the Monitor's (`watchLlm`, mail triage, stays on Cohere).
Setting `drafts.model` in `wren_settings`: 1 to 4 arms, each a `makeLlm` spec and a weight.
Default: `gateway:free` (Gemini first) 50, `cohere` 50.

## How

- An item's arm is a hash of its Inbox id onto the weights (`armOf`, FNV-1a plus a finalizer).
  Stable, no state, a redraft stays on its arm. One arm is no test.
- The worker hands drafting an `ArmedLlm` over `watchLlm`. Each draft site calls
  `modelFor(llm, item)`: the arm's client, built once and cached. An arm that can't be built
  here (no keys) is skipped; none buildable falls back to `watchLlm`, arm `null`.
  Non-draft calls (ranking, topics, reading a place) still use `watchLlm`. Clients keep theirs.
  The Inbox's own suggestions and AutoReply are untouched.
- The model's `generated` step records `by` = the model, `meta.arm` = the spec. The guard's run
  keeps the model too (`runs.model`), only for an arm's draft, so drops are counted by model.

## Scorecard

`wren drafts models [--since 14d|date] [--json]`, `ReachDesk.draftModels`, Engage > Draft models.
Per model: drafts that reached William, approved unedited, approved after edit (average
characters changed, share rewritten), rejected, open, dropped by the guard, redrafted by it,
comment proof (live / hidden / missing), answers back (thread and comment answers only; a DM
contact's inbound isn't tied to one draft). Labels from `model-labels.ts` ("Gemini 3.8 Flash",
"Command A"). Drafts with no `meta.arm` (history) show apart as "outside the test".

## Clear winner

In `verdict`: each of the two models with the most decided drafts has at least 40 decided
(approved or rejected), and the higher unedited-approve rate leads by at least 10 points. The
report says so. Nothing switches: set it with `wren drafts models set gateway:free:50 cohere:50`
(`... set cohere` ends the test, `... set default` restores the default).

## Not done

- The `free` chain's served model isn't captured; the label names the chain head (Gemini).
- Guard drops before this change have no model and can't be counted.
- No env var, no `lambda.tf` change: the setting is a table row, the gateway and Cohere keys are
  already on prod.
- No portal form for the arms; the CLI sets them.

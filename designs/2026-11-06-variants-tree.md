# Variants: the generation tree (WA-1120)

2026-11-06. William, 11-05: "saving the whole process is super important"; show how we zero in on a design over time. 11-06: port the Variants artifact to prod, with the portfolio site as the first subject; match the artifact; the story matches prod.

## Goal

A subject page shows every round in order: each sample's still, his call, his notes, the agent's idea and the line from parent to child. The strongest line reads first. Nothing is deleted.

## Target

Judge: pass 5 of artifact `A5xNkRRGMoMZuH8s7mvfRL`. Values port as is (`G={W:830,AX:168,TOP:34,GEN:112}`, node sizes per call, edge width `1.5+.75*min(live,4)`, rail, 300 px hover card, two-column detail, arrow keys).

| Part | Where |
|---|---|
| Model (pure) | `apps/portal/web/src/modules/variants/tree-model.ts` |
| View | `tree.tsx`, `tree.css` (`.vt-*`) |
| Page | `page.tsx` SubjectDetail: header, brief, tree, Live, Guides. The per-batch chart and batch list are gone: the tree holds both. |
| Blind | `packages/variants/src/console.ts` blanks `why`, `change`, `parentId` on an open batch; the model blanks them again |
| None of these | MarkBatch: one action marks every unmarked sample bad, closes the batch, hands to chat. Hidden once any sample is good. |
| Story | `pages-wren.stories.tsx` `VariantsTree` (synthetic, the artifact's example data) |

## Decisions (v1: no schema change)

Prod data has no calls on the portfolio subject: William wrote batch notes only. The artifact assumes calls. So v1 adds two calls the model derives:

- **grew**: no call, but a later batch grew from it. Drawn as a good-size node.
- **unmarked**: no call, no children.

Other derived fields:

- Name: first clause of `change`, up to 5 words (`shortName`). Open samples: "Sample A, B…".
- Took: the next closed batch's `why`.
- Locks: locked guides whose `decidedAt` falls between this batch's close and the next one's.
- Round call: "N to mark", "None of these" (all bad), "g of n good", "Note only".
- A parent that is missing, in the same row or later (a cycle) is dropped; the sample is a seed.

## Open: what the schema should hold (William's call)

The artifact also draws crosses (a child of two parents) and short names the agent picked. Vireo stores one `parent_id` and no name. Options:

| Option | For | Against |
|---|---|---|
| A. `parents int[]` + `name` on `samples` | One table, one migration, no join | No FK on array items; "what it took from each parent" has no home |
| **B. Edge table `lineage(child, parent, took)` + `name` on `samples`** | FK on both ends; a cross is one more row; each edge says what it took; `parent_id` becomes a view of the first edge | One join per tree read (a subject is hundreds of rows: no cost that matters) |
| C. `meta jsonb` on `samples` | No migration per new field | Unchecked; every reader parses; drift between agents |
| D. Keep v1 (derive all) | No change | No crosses; names change when the agent rewords `change` |

Ranked by: integrity in a public npm product, blind holds (a name or edge must hide while open, like `change`), then query cost.

**Recommend B.** Vireo is sold on its own; its data must be checked by the database, not by each reader. The `took` per edge is the fact the tree's detail panel shows today from the next batch's `why`, which is per batch, not per edge. Blind: `name` and `lineage` rows hide while the batch is open, the same seam as `change`.

## Proof

- Unit: `tree-model.test.ts` (empty subject, blind batch, grew/unmarked, bad parents and cycles, all-bad round, 40 loose plus 20 open samples in frame, lock rounds).
- Story shots at 390 and 1280, light and dark. Box-fit: 1 finding, a shell button also on the Subjects list story (not this change).

## Follow-ups

- Many samples in one row (20+) stay in frame but crowd. Widen `W` per row when real batches pass 12.
- Close and open, focus a branch, saved default views: William, 11-06, for the map and Layers. The tree's version is the "Good line" filter and the path light on select; a focus mode (hide what is off the line) is the next step if he wants it here too.

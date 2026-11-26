# Batches: actions at the top level

Task WA-1455. Parent doc: `designs/2026-11-05-variants.md` (Batches, 11-06).

William, 11-26: "one question for the batches top elvel view i want more ui actions at hte top levle ad  want to investigate that add tha tthe storybook too. opening a aprticular vairant and ivnestigating it looks good."

Terms: Vireo is the variant loop (repo `vireo/`, npm `@wrenautomation/vireo`); wren hosts it through `packages/variants`. A batch is one set of samples the agent made. Blind: while a batch is open, a person sees only their own marks, never the agent's reason or other people's calls.

## Now

`/variants/batches` (`apps/portal/web/src/modules/variants/batches.tsx`) is a hand page (`variants/index.ts`). With `?b=<ref>` it shows one batch (`OneBatch`). Without it, it shows `BatchList`: six native selects, rows that are plain links, no actions. Every action lives inside one batch (`BatchView`, `MarkBatch`).

The list predates the shared records list. No doc chose to keep it apart.

Prod, 11-26 (`prod-sql`: `select count(*), count(*) filter (where state='open') from vireo.batches`; `folders.folders`): 42 batches, 20 open, 9 subjects, 2 folders, no nesting. Only the newest open batch of a subject waits on him (vireo `store.ts:242`), so at least 11 open batches are "replaced". A replaced batch has no Close button anywhere, so it stays open for good.

## Target state

- The Batches list is the shared records list: tabs, Filter, search, sort, keys, picks, bulk, row actions, cards.
- From the list he can close a batch (one or many) and rename one, without opening it.
- A card click opens the batch page as now. He said that page "looks good"; it does not change.
- Blind holds on every read path.
- Stories cover the list, each action and the worst case.

## What acts on a batch

Keep, notes, steer, pin to board and open live act on one sample. They stay on the batch page.

| Action | Where | Applies to | Bulk | Asks first |
|---|---|---|---|---|
| Close | list and batch page | Waiting, Replaced | yes | "Close this batch? Its marks stay; Vireo is not told." |
| Rename | list and batch page | any | no | the title box (`ask`, from `title`) |
| Hand to Vireo | batch page only | Waiting | no | as now |
| None of these | batch page only | Waiting | no | as now |
| Open | list (card click, Enter) | any | no | no |

Hand to Vireo and None of these are calls on the samples. Each needs the samples in view, and each sends the chat line that tells the agent to read the calls (`page.tsx:156`). A blind list row has no tally and no verdicts, and None of these from the list would mark samples bad that he never saw. So both stay on the batch page.

`variants/close` accepts any open batch, Replaced too (vireo `store.ts:889`).

Precedent: PT-10, Linear's issue list. A row shows its first actions on hover and the rest behind ⋯; a selection gets a bulk bar; the row opens the issue.

## D1. Where the list lives

| Option | How | New seams | For | Against |
|---|---|---|---|---|
| A. Actions on the hand-built list | `RowActions` on each row; the selects stay | none | smallest change | no tabs, keys, picks or bulk; a second list system |
| B. A `variants.batch` record type | `defineRecord` with `rows` from Vireo; the hand page embeds the list | 1: `ListPage.live` | every list feature, now and later | the poster strip becomes one poster per card |
| C. Shared parts on the hand-built list | the page wires `RowActions`, the Filter tool and `Bulk` to `variants/batches` itself | none | data path unchanged | tabs, keys, cursor and saved views redone for one page |
| D. Close on the batch page only | a Close button in `OpenBatch`'s replaced branch | none | one button | no top-level action, which is what he asked for |

Priorities, in order: blind holds; one list system (rows everywhere, shared parts once); the actions he asked for; risk.

Recommendation: B. Its one seam serves every list.

How B fits without new list code:
- `BatchesPage` stays the hand page. Without `b` or `batch`, it renders `TemplatePage` over the record, as `StudioVideo` does (`marketing/video-shelf.tsx:148`).
- The record's `name.one` is "batch" and its key is the numeric id. A card click writes `?batch=<id>` (`records-list.tsx:492`), which `BatchesPage` already opens as `OneBatch`.
- Close and Rename go through the portal's `ONE` map (`apps/portal/web/src/records.tsx:199`): one `variants/close {batch}` or `variants/rename {batch, name}` per id.
- The new seam: `ListPage.live` names live topics. The list reads again on a push, as the record page does (`records-page.tsx:301`). Batches passes `["variants"]`.

Trade-off taken: cards, not rows. Rows would show no poster at all; cards show the first sample's poster. In Wren's workspace cards are the page's only view (WA-1453), so phone swipes give way to the card's own action foot. The batch page still shows every sample.

## D2. Blind on the new paths

`rows(db, me)` feeds the list, counts, search, export and Claude's reads (`records-serve.ts:636`). Vireo treats a null viewer as the agent and shows all (vireo `store.ts:239`).

- `rows` reads as `me?.email ?? ""`. An empty viewer is blind, so it fails closed.
- While open, `why`, `tally`, `goodRate` and `judges` come back null and `marked` is the viewer's own count (vireo `store.ts:1358`). Every field reads from that answer.
- `thumbs(db, ids)` has no viewer. It returns a poster only, never a verdict.
- `rows` reads every page of `batches` (limit 100, `after`) and dedupes by id. A second read with `who` sets `yours`. 42 rows today. Budget: the list call under 300 ms on the dev server.
- A unit test reads an open batch as a person and as no one. It finds no `why`, tally, rate or judges, and `marked` is the viewer's own.

## D3. Fields, tabs and filters

- Fields: subject (choice), title, batch n, kind (status), state (status: Waiting, Replaced, Closed), marked ("3 of 8"), good rate, kept, judges, folder (choice), yours (yes or no), created, agent's reason, note.
- Tabs: Waiting, Replaced, Closed, All. Waiting rows lead under "Needs you" (`ListPage.needs`).
- Quick filters: subject, kind, folder.
- The card: subject on the top line, kind top right, title, poster, marked and good rate in the foot.
- The first-run empty state's "Start in the chat" button sits in `ListPage.head`.
- Old links: every in-repo link uses `?b=`; it still opens the batch page. Old sort and filter params drop.

Trade-off taken: a folder filter matches its own subjects, not sub-folders. Prod has no nesting.

## Files

- `packages/variants/src/records.ts` (new): `batchRecord(at)`, with Vireo and the signer passed in. Registered in `consoleRecords` (`apps/worker/src/console-records.ts`) and wired in `apps/worker/src/services/platform.ts`.
- `packages/variants/src/records.test.ts` (new): the blind test.
- `apps/portal/web/src/module.ts`, `packages/ui/src/records-list.tsx`, `records-types.ts`, `apps/portal/web/src/records.tsx`: `ListPage.live`.
- `apps/portal/web/src/records.tsx`: `ONE` entries for `variants/close` and `variants/rename`.
- `apps/portal/web/src/modules/variants/batches.tsx`: `BatchList`, `Pick` and `BatchRow` go; the list page spec and its actions come in.
- `apps/portal/web/src/mocks/data/records.ts`: synthetic batch rows.
- `apps/portal/web/src/stories/vireo/batches.stories.tsx`: `Sorted` and `PickSort` go; new stories below.

## State table

| State | Shows | Enters on | Next | Motion out |
|---|---|---|---|---|
| Loading | card skeletons | open page | typical, empty, failed | the list's own fade |
| Empty, first run | "No batches yet"; Start in the chat in the head | no batches | typical | instant: a new batch arrives by live push |
| Empty, filtered | "No batch matches" + Clear | filters | typical | the list's own |
| Typical | Needs you, then the rest | data | hover, open, pick | none |
| Card hover | its action foot lights | pointer, focus, cursor | action, menu | 150 ms, the shared card's |
| Confirm | the Close question; "2 batches" when picked | Close | done, cancelled | the dialog's own |
| In flight | the dialog waits for the answer | confirm | done, failed | the dialog's own |
| Done | toast; the card leaves Waiting or Replaced | answer | typical | the list's own |
| Failed | the refusal in the toast; the card stays | 4xx, 5xx | typical | the list's own |
| Bulk | the bar: Close | picks | confirm | the list's own |
| Live push | new or changed cards | a Vireo write | typical | the list's own |
| Many | 100+ cards, paged by the list | data | | none |
| Long text | a 120-char title and subject wrap; no ellipsis | data | | none |
| Partial | no title, no poster, no rate | data | | none |
| No permission | the page is team only (`requires`) | client login | | none |
| Narrow 390 | one card across | width | | none |
| Wide 1280 | cards fill the row | width | | none |

Every motion is the shared list's. This change adds none.

## Stories (`apps/portal/web/src/stories/vireo/batches.stories.tsx`)

Default, Replaced tab, Closed tab, Close on one, Close on two picks, Rename, a failed close, worst case (long names, no posters, 120 rows), first run, 390.

## Non-goals

- The batch page (`OneBatch`, `MarkBatch`): no change.
- Sample actions on the list.
- Hand to Vireo and None of these on the list (D1, "What acts on a batch").
- A Subjects list.

## Risks

- Each list view reads Vireo twice (page and counts), and each read makes two `batches` calls (rows and `yours`). Measure on dev against the 300 ms budget.
- Close from the list does not tell the agent. Only a replaced batch, which the agent moved past, should need it; a waiting batch's Close asks first and says so.

## Log

- 2026-11-26: doc written. Options A, B, C, D; B recommended.
- 2026-11-26: goldfish review: 30 findings (critic 15, reader 15), 19 applied after zoom-out, 11 rejected or moot; seams cut from three to one (`ListPage.live`); Hand to Vireo and None of these stay on the batch page; cards over rows (zoom-out picked rows; posters decide). Open: none.

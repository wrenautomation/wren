# To approve as cards

Task WA-1453. Parent doc: `designs/2026-11-26-raycast-light.md` (D3 moved here).

William, 11-26: "to approve a s abucnh fo bento cards is fne. lets lock in those, maybe start makigna storybook / transfering wren over to that."

William, 10-21 (commit `882dfc5d0`): "The Rows / Cards switch is gone": one desk view on every list. The card grid, every page's card spec and the `as=cards` setting were deleted.

The two calls fit: one page gets cards, and it gets one view, not a switch.

## Target state

- In Wren's workspace, Today › To approve draws its items as a grid of cards. It is that page's only view. By site groups the cards.
- A card shows the site, the kind and its wait, the title, the poster, the whole text, why it is held, and its actions.
- Tabs, tiers, filter, search, sort, picks, bulk, the peek, the wash after an action and optimistic Approve work as in the Table.
- Clients see no change: Table and By site, as now.
- One card face in `packages/ui` serves this grid and the Shop template. It has stories on synthetic drafts.

## Source order

The page's structure comes from the style set's v116 Today, cards mode (https://0af8df62.wren-style-set.pages.dev/v116/; canon `topics/ui-design/builds/2026-11-25-wren-style/layouts-d.mjs`, `draftCard`). His 11-26 quote picks it for this page. The design-language artifact still judges the parts inside the card (buttons, tags, type).

## Precedent

v116 Today: a 4-across grid. A card: the site word, kind · age, a bold title, a 16:9 poster, the text, the note. Edit and Approve open in an expand on click or Enter.

What we change:
- The actions are always in view. The expand costs a click per card on a page he works through.
- The column count follows the room (`auto-fill`, least 240 px), not a fixed four.
- No head tile, no Oldest tile, no "Approve all X posts". The page head stays the List's. No bulk action backs "Approve all" today.

## D1. Where the cards live

| Option | How | For | Against |
|---|---|---|---|
| A. A `tiles` layout inside `Rows` | `Rows` draws cards for the same lines | one part | `Rows` decides narrow first and runs its virtual list; at 390 and beside the peek it would draw the phone list, not cards |
| B. A new `cards` template beside Shop | its own page part | free of the List | redoes tabs, tiers, bulk, peek and optimistic Approve |
| C. The Shop template | facets down the side, a card per record | built | a catalog browser: no tabs, no tiers, no bulk |
| D. Bring back the deleted card grid | `RecordList` draws `CardGrid` in place of `Rows`, with the same rows, picks, cursor and actions (`882dfc5d0^:packages/ui/src/card-grid.tsx`) | it was built and tested; it already had full-row bands for tiers and folds, `items-start`, a sort pick, a cursor state and the thumbs ask | 400 lines back; its switch stays gone |

Ranked by: same behaviour as the Table > reuse > less code. **Pick D.** The grid comes back without its Rows / Cards switch and without per-page specs for other pages.

## D2. The gate and the address

- `ListPage` gets `cardGrid?: CardSpec` (`apps/portal/web/src/module.ts`). Only To approve sets it.
- `TemplatePage` passes it to the List only when `wren` is true (`records.tsx`, `props.client === WREN.id`). Else the List draws as now.
- With `cardGrid`, the List draws the grid. No address key is added. The bar's first chip reads "Cards" in place of "Table"; By site keeps `?group=platform` and groups the cards.
- `Rows.cards` (outlined rows) keeps its name and job. The new key is `cardGrid`.
- `list-bar.test.ts` "cards are gone" changes to: no Rows / Cards switch, and no `as=cards`.

## D3. The card

One face, `RecordCard`, for this grid and for Shop (Shop's `Card`, `shop.tsx`, moves into it). Props: the record meta, the row, the spec, `open`, `picked`, `cursor`, `going`, `changed`, the thumb, and the actions.

| Slot | To approve | Draw |
|---|---|---|
| top left | `platform` | its cue as a word tag; none when `platform` is null (workflows, pages, credits) |
| second line | `kind`; the wait from `due` | "Post draft · 1 day"; the wait in amber only when late, as the Table's `Age` |
| title | the meta's `title` (`who`) | 15 px, 600, whole |
| poster | the row's thumb | 16:9, cover; drafts and videos. The List asks for thumbs only when it draws the grid, in the load and the prefetch |
| body | the meta's `subtitle` (`body`) | whole, ink-2 |
| note | `held` | ink-2, whole. Amber means late only |
| foot | `sendAt` when set; the actions | left: "Sends 10:30" (Queued tab). Right: `RowActions` `still`, with the first main action as an outlined button (Approve) and ⋯. The page head keeps the one filled Approve |

## Layout

- Grid: `repeat(auto-fill, minmax(240px, 1fr))`, gap 12 px, `items-start`. Long text makes a tall card, not a tall row of empty cards.
- Tier heads ("Needs you", "For info") and By site folds span the full row. A row's box (a reason, a reply) opens in its own card, under the card's words, where its actions were.
- Card: `--ui-paper`, `--ui-raise`, `--ui-radius-panel`, padding 14 × 16, gap 8. Open and picked: the accent tint. Cursor and hover: the accent wash, 150 ms, as a row.
- Pick: a checkbox in the card's top right. It shows on hover and focus, and on every card once one is picked.
- Docked peek: the grid narrows beside it and keeps its actions (the List drops row actions when docked; the grid does not).
- 390: one column of the same card. No swipes: the actions are in view.
- Keys: ↑ ↓ j k walk the cards in reading order, one at a time, as the List's walk does. ← → are not bound.
- Sort: the old grid's sort pick in the bar. Display hides Columns and density.
- No virtual list. The page size caps the cards (`PageBar`).

## States

| State | What shows | Enters on | Next | Motion out |
|---|---|---|---|---|
| Loading | 8 card skeletons | first open | cards, empty, failed | fade, as the Table's |
| Tab, filter, search | the old cards stay; the tab's ring turns | a change | cards | instant, as the Table |
| Empty, empty filter, failed | the List's `Empty` and `LoadFailed` | the load | | |
| One card | one card at its least width, at the left | data | | |
| Cards | the grid | data | open, picked, cursor | |
| Long text, no poster, no platform | a tall card; no poster slot; no tag | data | | |
| Cursor | the accent wash on the card | ↑ ↓ j k | another card | instant |
| Open | the tinted card; the peek docks (900 px and up) or opens as a sheet | click, Enter | another open, closed | the peek's own |
| Picked | the tinted card; the bulk bar | checkbox, x | bulk run, cleared | instant |
| Confirm (post draft Approve) | the action's confirm dialog | Approve on a draft | approved, cancelled | the dialog's own |
| Going (reply Approve) | the busy tag in the foot; the card stays | Approve on a reply | approved, failed | |
| Approved | the card goes; the wash plays on what changed | the run ends | | instant, as a row |
| Action failed | the card stays; the List's error | the run fails | | |
| Box open | the box in its card, in place of its actions; the card grows, no other card moves | Redraft, Reject, Reply | sent, closed | as the Table's box |
| Queued tab | "Held because" in the note; "Sends at" in the foot | tab | | |
| Client | Table and By site, no grid | not `wren` | | |

## Non-goals

- No Rows / Cards switch on any page. No card specs for other pages.
- No cards for clients.
- No head tile, no Oldest tile, no "Approve all X posts".
- No leave motion for an approved card: a row has none either.
- No select-all in the grid; the bulk bar works on picked cards.

## Proof

Stories: `RecordCard` (draft with poster, video, reply, broadcast, workflow with no platform, long text, late) and To approve as cards (typical, empty, queued, open, picked, box open, worst case), plus the client view of the same page (Table). Shots at 390 and 1280 in `wren` and `raycast`, light and dark; box-fit; tells; fresh-eye review against v116 Today. Shop's stories reshot after the card face move.

## Open

- Cards for clients. Owner: William. Recommendation: later, after he uses it.

## Log

- 11-26: D1 picked D (the 10-21 grid back, one page, no switch). Cards replace the Table on To approve in Wren's workspace.
- 11-26: goldfish review (critic, reader, zoom-out): 35 findings, 26 applied, 9 rejected (the leave motion and its fixes, a new `shape` param, the look-context gate, wording churn); open: cards for clients.
- 11-26: built. Fresh-eye review: 12 findings, 5 applied. Applied: Approve is outlined on the card (6 filled buttons broke the purple cap); kind and wait sit under the site on every card, so titles in a row line up; a By site fold drops the site from its cards; the note label takes a colon; the field `Sends at` is now `Sends`. Rejected: icon hit areas (they are 28 px, 44 px on touch); the second hue on Approving (that is raycast's accent); the ragged rows (D3 picked natural height). Pre-existing, on the hand-off list: the head Approve, the peek's empty fields, the bar's sideways scroll at 390.
- 11-26 (WA-1455): a row's box moved into its card. As a full-row line it sat after the card, not after the card's grid row, and pushed the cards beside it to the next row. The grid cannot know where a row ends without measuring it; inside the card nothing else moves. Story `ApproveCardsBox`.

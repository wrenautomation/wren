# CRM rows everywhere

William, 2026-10-21: "the crm rows just replaces the table rows we have throughout the entire UI." The design is locked in artifact SuhuZqr8, section 15 (F1 to F3). The source copy is `designs/2026-10-20-design-language/design-language.src.html`. The Inbox and People decisions are in `designs/2026-10-20-design-language.md`, Decisions.

## Target

Every list of rows in the portal draws through one table part: `packages/ui/src/table.tsx` (TanStack Table), with records in `records.tsx`. No page draws its own rows.

The row look (F1):
- Column lines, hairline rows, a property icon in each header.
- A gutter checkbox for each row (on hover, and always once one is checked).
- The name cell has an avatar or mark, and an "Open" chip on hover.
- A pill for a kind or queue. A square for a stage, in the stage colour (Stranger ink-3, Lead l0, Replied l1, Booked l3, Client l2).
- Wait or age in the last column. Amber only when late, as text or a dot, never a fill.
- One quiet icon action at the row end. More actions show on hover. The icon acts in place, with Undo.
- A count footer.

Views (F2): Table and Group by (folds with count and oldest wait). No board.

Row click (F3): a side peek with the record's properties, its last activity and the main action (for a person, a reply box). On the phone the peek is a sheet. Full record stays one click away ("Open").

On the phone (≤720px): name, one property, the action. The other columns hide.

## People as the CRM (wa-7oo.13)

People is the CRM. Every lead and client has a record and a timeline. The People table is the first adopter and the reference. Its peek is the person record: stage, warmth, owner, last touch, the timeline head, and reply. The Inbox queues (wa-7oo.15) are saved views of the same table.

## Scope

1. The F1 to F3 look and behaviour in the shared table part, with stories (light, dark, phone).
2. People on it, with the peek.
3. Inbox: overview E and the queue tables.
4. Every other page that lists rows: move it to the shared part. About 80 module files draw rows by hand today. Inventory them first. Each one moves, or the report says why it is not a list.
5. Remove the per-page row code that is left.

Out: the Map (last), the pricing model C2 (last).

## Rules

- One write path for each action. Test a tab-away, a race and a grouped view for each.
- Story tests are render, play and axe. No pixel baselines.
- Sample data only. The repo is public.

## Decisions (planner, 2026-10-21)

Briefs: `designs/briefs/2026-10-21-crm-rows-{r1,r2,r3,inventory}.md`.

- **One part.** `Rows` (`packages/ui/src/rows.tsx`) draws every list. `List` (records) and hand pages both feed it. `DataTable` and `FactsTable` stay for facts only. A real `<table>` stays (roles, axe, the libs guard).
- **Late.** One helper, `lateOf` in `packages/core/src/promise.ts`. A list page declares `late: { field, promise }`. The Map keeps its own copy until the Map work lands.
- **Stage colours.** `State.line` (0 to 7, `--ui-line-N`) is a new field. `tint` stays for kinds (the `--ui-cue-N` palette).
- **Inbox data.** No cross-product union record. `marketing.inbox` already unions the channels. Each other queue (approvals, mail, mentions, issues, asks) keeps its own record and page. Overview E is the cross-queue view. Its count and oldest come from one list read per queue.
- **Phone.** The kit's one breakpoint (900px) stays. The artifact's 720px is not added.

William's call (defaults in place, change any):

1. Queue promises: 24h for every Inbox queue.
2. The peek floats at the right (560px), over the table. The artifact draws it beside a narrowed table.
3. The peek is the default for every list. A page opts out with `peek: false`.
4. People has no owner field. The peek leaves Owner out. Adding one is a data change.
5. Group count and oldest are of the loaded page, not the whole list.

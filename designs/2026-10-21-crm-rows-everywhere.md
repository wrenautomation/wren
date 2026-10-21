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

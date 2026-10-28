# Pipelines: app, wren workspace

Wren's own people by node of the shape: who is booked, who is signed, who has stalled.

Sidebar: team: Primary.

Registered in `apps/portal/web/src/modules/deals/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Board | hand | `apps/portal/web/src/modules/deals/board.tsx` | Everyone by node, to drag down the shape as they move. |
| Journeys | list of `pipeline.journey` | `apps/portal/web/src/records.tsx` | Every journey, open, done and dropped. |
| Deals | list of `pipeline.deal` | `apps/portal/web/src/records.tsx` | Every deal, open, won and lost, with its signed terms. |
| Calls | list of `email.call` | `apps/portal/web/src/records.tsx` | Sales calls booked with you, past and coming up. |
| Entries | list of `pipeline.entry` | `apps/portal/web/src/records.tsx` | Each source of the shape: what opens a journey, and when one last did. |

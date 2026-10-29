# Pipelines: app, wren workspace

Wren's own people by node of the shape: who is booked, who is signed, who has stalled.

Sidebar: team: Primary.

Registered in `apps/portal/web/src/modules/deals/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Board | hand | `apps/portal/web/src/modules/deals/board.tsx` | `PipelineConsole/journeysDrop`, `PipelineConsole/journeysMove`, `PipelineConsole/recordsGet`, `PipelineConsole/recordsList` | Everyone by node, to drag down the shape as they move. |
| Journeys | list of `pipeline.journey` | `apps/portal/web/src/records.tsx` | `pipeline.instances`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `public.documents`, `public.profile_keys`, `public.profiles` | Every journey, open, done and dropped. |
| Deals | list of `pipeline.deal` | `apps/portal/web/src/records.tsx` | `pipeline.deals`, `pipeline.instances`, `pipeline.shape_versions`, `pipeline.terms_versions`, `public.documents`, `public.profiles` | Every deal, open, won and lost, with its signed terms. |
| Calls | list of `email.call` | `apps/portal/web/src/records.tsx` | `public.call_bookings`, `public.companies`, `public.enrollments`, `public.people` | Sales calls booked with you, past and coming up. |
| Entries | list of `pipeline.entry` | `apps/portal/web/src/records.tsx` | `pipeline.instances`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `public.documents`, `public.profiles` | Each source of the shape: what opens a journey, and when one last did. |

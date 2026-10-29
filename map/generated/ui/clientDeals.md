# Journeys: app, client workspace

Every person by node of the shape, and how long they have been there.

Sidebar: client: Leads.

Registered in `apps/portal/web/src/modules/deals/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Board | hand | `apps/portal/web/src/modules/deals/board.tsx` | `PipelineConsole/journeysDrop`, `PipelineConsole/journeysMove`, `PipelineConsole/recordsGet`, `PipelineConsole/recordsList` | Everyone by node, to drag down the shape as they move. |
| Journeys | list of `pipeline.journey` | `apps/portal/web/src/records.tsx` | `pipeline.instances`, `pipeline.shape_drafts`, `pipeline.shape_versions`, `public.documents`, `public.profile_keys`, `public.profiles` | Every journey, open, done and dropped. |

# Workflows: app, wren workspace

How Wren wins clients and runs, drawn with live numbers.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| All | hand | `apps/portal/web/src/modules/wren/automations.tsx` | `ConsolePortal/recordsList`, `ConsolePortal/workflowsMade` | Everything that runs on its own: what starts it, how it went, its switch. |
| New | hand | `apps/portal/web/src/modules/wren/automations.tsx` | `ConsolePortal/recordsList`, `ConsolePortal/workflowsMade` | Start from a template, describe one, or start blank. |
| Canvas | hand | `apps/portal/web/src/modules/wren/workflows.tsx` | `AccountsConsole/accounts`, `AccountsConsole/usage`, `ConsolePortal/agents`, `ConsolePortal/call`, `ConsolePortal/decisions`, `ConsolePortal/doorReveal`, `ConsolePortal/doorRotate`, `ConsolePortal/loops`, `ConsolePortal/question`, `ConsolePortal/recordsEdit`, `ConsolePortal/recordsGet`, `ConsolePortal/recordsList`, `ConsolePortal/recordsStats`, `ConsolePortal/recordsTypes`, `ConsolePortal/recordsUndo`, `ConsolePortal/replay`, `ConsolePortal/retryEvent`, `ConsolePortal/setLook`, `ConsolePortal/templateInstalls`, `ConsolePortal/tokens`, `ConsolePortal/viewAsList`, `ConsolePortal/workflowAnswer`, `ConsolePortal/workflowAsk`, `ConsolePortal/workflowDelete`, `ConsolePortal/workflowDiscard`, `ConsolePortal/workflowDoors`, `ConsolePortal/workflowSave`, `ConsolePortal/workflowTest`, `ConsolePortal/workflowsMade`, `DeliveryPortal/domains`, `DeliveryPortal/me`, `DeliveryPortal/webhooks`, `DocumentsConsole/create`, `DocumentsConsole/send`, `DocumentsConsole/templateSave`, `DocumentsConsole/templates`, `EmailConsole/dossier`, `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `MarketingConsole/reports`, `PaymentsConsole/connect`, `PaymentsConsole/status`, `PeopleConsole/broadcastContext`, `PeopleConsole/broadcastMonth`, `PeopleConsole/broadcastPreview`, `PeopleConsole/broadcastSave`, `PeopleConsole/segmentContext`, `PeopleConsole/segmentDescribe`, `PeopleConsole/segmentPreview`, `PeopleConsole/segmentSave`, `PeopleConsole/segmentVersions`, `PipelineConsole/journeysDrop`, `PipelineConsole/journeysMove`, `PipelineConsole/recordsGet`, `PipelineConsole/recordsList`, `TemplatesConsole/list`, `keys/stage` (host), `media/grant` (host) | Every workflow as it's wired, with its numbers. |
| Executions | list of `console.execution` | `apps/portal/web/src/records.tsx` | `public.executions` | Each person's path through a workflow, and where they are now. |
| Events (link only) | list of `console.event` | `apps/portal/web/src/records.tsx` | `public.executor_events` | Workflow steps that failed, and why. |
| Holds | list of `console.hold` | `apps/portal/web/src/records.tsx` | `public.unit_holds_now` | Work a check held back, and until when. |
| Checks | list of `console.check` | `apps/portal/web/src/records.tsx` | `public.check_rates` | How often each check passes, by stage and source. |

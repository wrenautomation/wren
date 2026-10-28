# Workflows: app, wren workspace

How Wren wins clients and runs, drawn with live numbers.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| All | hand | `apps/portal/web/src/modules/wren/automations.tsx` | Everything that runs on its own: what starts it, how it went, its switch. |
| New | hand | `apps/portal/web/src/modules/wren/automations.tsx` | Start from a template, describe one, or start blank. |
| Canvas | hand | `apps/portal/web/src/modules/wren/workflows.tsx` | Every workflow as it's wired, with its numbers. |
| Executions | list of `console.execution` | `apps/portal/web/src/records.tsx` | Each person's path through a workflow, and where they are now. |
| Events (link only) | list of `console.event` | `apps/portal/web/src/records.tsx` | Workflow steps that failed, and why. |
| Holds | list of `console.hold` | `apps/portal/web/src/records.tsx` | Work a check held back, and until when. |
| Checks | list of `console.check` | `apps/portal/web/src/records.tsx` | How often each check passes, by stage and source. |

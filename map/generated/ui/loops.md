# Loops: app, wren workspace

Every scheduled job, which ones fail, and Wren's own settings.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Everything that runs on its own, and whether it's healthy. |
| Agents | hand | `apps/portal/web/src/modules/wren/Agents.tsx` | `ConsolePortal/agents`, `ConsolePortal/decisions`, `ConsolePortal/loops`, `ConsolePortal/recordsStats` | Everything that runs for Wren, by department. |
| Loops | list of `console.loop` | `apps/portal/web/src/records.tsx` |  | Every loop, and whether it's running or failing. |
| Settings | list of `console.setting` | `apps/portal/web/src/records.tsx` | `public.wren_settings` | Settings for the parts that run for Wren. |
| Flags | list of `loops.flag` | `apps/portal/web/src/records.tsx` | `public.flags` | Switches the code reads to turn a feature on or off. |
| Infra | hand | `apps/portal/web/src/modules/wren/infra.tsx` | `ConsolePortal/recordsList` | Every host, and what calls what. |

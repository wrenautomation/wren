# Loops: app, wren workspace

Every scheduled job, which ones fail, and Wren's own settings.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` | Everything that runs on its own, and whether it's healthy. |
| Agents | hand | `apps/portal/web/src/modules/wren/Agents.tsx` | Everything that runs for Wren, by department. |
| Loops | list of `console.loop` | `apps/portal/web/src/records.tsx` | Every loop, and whether it's running or failing. |
| Settings | list of `console.setting` | `apps/portal/web/src/records.tsx` | Settings for the parts that run for Wren. |
| Flags | list of `loops.flag` | `apps/portal/web/src/records.tsx` | Switches the code reads to turn a feature on or off. |
| Infra | hand | `apps/portal/web/src/modules/wren/infra.tsx` | Every host, and what calls what. |

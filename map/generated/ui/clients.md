# Clients: app, wren workspace

Every client, how each is doing, and what needs a look.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` | How your clients are doing, at a glance. |
| Clients | list of `console.client` | `apps/portal/web/src/records.tsx` | Every client, with what they bought and how it's going. |
| Health | list of `console.health` | `apps/portal/web/src/records.tsx` | Each client's health score, lowest first. |
| Flags | list of `console.flag` | `apps/portal/web/src/records.tsx` | Risks and openings flagged on clients, to own and close. |
| Health by day (link only) | list of `console.health_day` | `apps/portal/web/src/records.tsx` | Each client's health score, day by day. |
| Health inputs (link only) | list of `console.health_input` | `apps/portal/web/src/records.tsx` | The numbers behind each health score. |
| Vendor usage | hand | `apps/portal/web/src/modules/account/summary.tsx` | What each client used of each vendor this month. |

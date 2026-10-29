# Clients: app, wren workspace

Every client, how each is doing, and what needs a look.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | How your clients are doing, at a glance. |
| Clients | list of `console.client` | `apps/portal/web/src/records.tsx` | `public.client_records` | Every client, with what they bought and how it's going. |
| Health | list of `console.health` | `apps/portal/web/src/records.tsx` | `delivery.console_health` | Each client's health score, lowest first. |
| Flags | list of `console.flag` | `apps/portal/web/src/records.tsx` | `delivery.console_flags` | Risks and openings flagged on clients, to own and close. |
| Health by day (link only) | list of `console.health_day` | `apps/portal/web/src/records.tsx` | `delivery.console_health_days` | Each client's health score, day by day. |
| Health inputs (link only) | list of `console.health_input` | `apps/portal/web/src/records.tsx` | `delivery.console_health_inputs` | The numbers behind each health score. |
| Vendor usage | hand | `apps/portal/web/src/modules/account/summary.tsx` | `AccountsConsole/accounts`, `AccountsConsole/usage` | What each client used of each vendor this month. |

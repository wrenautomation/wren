# Team: app, wren workspace

Who on Wren's team signs in, their role, which clients they see, and who changed what.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | For |
|---|---|---|---|
| Team | list of `console.team` | `apps/portal/web/src/records.tsx` | Your team, and when each person last signed in. |
| Roles | list of `access.role` | `apps/portal/web/src/records.tsx` | The roles people can hold, and what each one may do. |
| Grants | list of `access.grant` | `apps/portal/web/src/records.tsx` | Extra access given to someone beyond their role. |
| Access review | list of `access.review` | `apps/portal/web/src/records.tsx` | Who can reach what, to check it's still right. |
| Changes | list of `console.change` | `apps/portal/web/src/records.tsx` | Who changed what in the last 7 days. |

# Team: app, wren workspace

Who on Wren's team signs in, their role, which clients they see, and who changed what.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Team | list of `console.team` | `apps/portal/web/src/records.tsx` | `auth.session`, `auth.user`, `public.operators`, `public.roles` | Your team, and when each person last signed in. |
| Roles | list of `access.role` | `apps/portal/web/src/records.tsx` | `public.client_members`, `public.operators`, `public.role_grants`, `public.roles` | The roles people can hold, and what each one may do. |
| Grants | list of `access.grant` | `apps/portal/web/src/records.tsx` | `public.grants` | Extra access given to someone beyond their role. |
| Access review | list of `access.review` | `apps/portal/web/src/records.tsx` | `public.client_members`, `public.clients`, `public.grants`, `public.operators`, `public.role_grants`, `public.roles` | Who can reach what, to check it's still right. |
| Changes | list of `console.change` | `apps/portal/web/src/records.tsx` | `public.audit_changes` | Who changed what in the last 7 days. |

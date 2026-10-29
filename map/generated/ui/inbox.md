# Inbox: app, wren workspace

Every lead's answer, by email, text or DM, and the mail that needs you.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/wren/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Everything that waits on you, across channels. |
| Your mail | list of `watch.mail` | `apps/portal/web/src/records.tsx` |  | Your own email that needs you, pulled from the rest. |
| Done | list of `marketing.done` | `apps/portal/web/src/records.tsx` |  | What you approved, rejected, edited or sent, newest first. |
| Mail rules | list of `watch.rule` | `apps/portal/web/src/records.tsx` |  | Rules that hide email you don't need to see. |
| Issues (link only) | list of `access.issue` | `apps/portal/web/src/records.tsx` |  | Problems raised on a record, waiting on a fix. |
| Access asks (link only) | list of `access.ask` | `apps/portal/web/src/records.tsx` |  | Requests for access, waiting on an answer. |
| Mentions (link only) | list of `notes.mention` | `apps/portal/web/src/records.tsx` |  | Notes where someone tagged you with @. |
| Email replies (link only) | queue of `email.reply` | `apps/portal/web/src/records.tsx` |  | Warm email replies, each with a drafted answer. |

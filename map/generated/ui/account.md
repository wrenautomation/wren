# Account: app, client workspace

Your company's details, who can see your projects, your email settings, your look, your mailboxes, your social accounts, the accounts and vendors Wren works in, webhooks, AI tools, your own fields and business facts, invoices and who changed what.

Registered in `apps/portal/web/src/modules/account/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Overview | hand | `apps/portal/web/src/modules/account/Overview.tsx` |  | What you have with us, who's on your account and what's owed. |
| Your settings | hand | `apps/portal/web/src/modules/account/You.tsx` |  | Settings that are just for you. |
| People | hand | `apps/portal/web/src/modules/account/People.tsx` | `ConsolePortal/viewAsList`, `DeliveryPortal/me` | Everyone on your account, and their roles. |
| Roles | list of `access.role` | `apps/portal/web/src/records.tsx` |  | The roles people can hold, and what each one may do. |
| Grants | list of `access.grant` | `apps/portal/web/src/records.tsx` |  | Extra access given to someone beyond their role. |
| Access review | list of `access.review` | `apps/portal/web/src/records.tsx` |  | Who can reach what, to check it's still right. |
| Access asks | list of `access.ask` | `apps/portal/web/src/records.tsx` |  | Requests for access, waiting on an answer. |
| Look | hand | `apps/portal/web/src/modules/account/Look.tsx` | `ConsolePortal/setLook`, `DeliveryPortal/me` | Your workspace's colors. |
| Domain | hand | `apps/portal/web/src/modules/account/Domain.tsx` | `DeliveryPortal/domains` | Open this portal at your own web address. |
| Accounts | hand | `apps/portal/web/src/modules/account/Accounts.tsx` | `AccountsConsole/accounts` | Each account Wren works in for you, and what's left to set up. |
| Mail | hand | `apps/portal/web/src/modules/account/Mail.tsx` | `MailAccess/mail` | The mailboxes Wren sends from and reads. |
| Social | hand | `apps/portal/web/src/modules/account/Social.tsx` | `SocialAccess/ownCheck`, `SocialAccess/social` | The social accounts Wren posts from and answers on. |
| Connectors | hand | `apps/portal/web/src/modules/account/Connectors.tsx` | `Connectors/connectors` | The apps you already use, which Wren reads every hour. |
| Vendors | hand | `apps/portal/web/src/modules/account/Vendors.tsx` | `AccountsConsole/accounts`, `AccountsConsole/limits`, `AccountsConsole/vendors`, `keys/stage` (host) | The services your work runs on, and this month's use. |
| Webhooks | hand | `apps/portal/web/src/modules/account/Webhooks.tsx` | `DeliveryPortal/webhooks` | Send events to your own tools as they happen. |
| AI tools | hand | `apps/portal/web/src/modules/account/AiTools.tsx` | `ConsolePortal/tokens`, `DeliveryPortal/webhooks` | Let Claude Code or your own script use your Wren. |
| Fields | hand | `apps/portal/web/src/modules/account/Fields.tsx` | `ConsolePortal/viewAsList`, `DeliveryPortal/me` | Your own fields on your lists. |
| Business facts | hand | `apps/portal/web/src/modules/account/Fields.tsx` | `ConsolePortal/viewAsList`, `DeliveryPortal/me` | Your phone, address, hours and the like, kept in one place. |
| Messaging | form of `delivery.messaging` | `apps/portal/web/src/records.tsx` |  | How many marketing messages one person gets, and how links are tagged. |
| Billing | list of `delivery.invoice` | `apps/portal/web/src/records.tsx` |  | Your invoices from Wren, paid and due. |
| Issues | list of `access.issue` | `apps/portal/web/src/records.tsx` |  | Problems raised on a record, waiting on a fix. |
| Changes | list of `delivery.change` | `apps/portal/web/src/records.tsx` |  | Who changed what in your account. |

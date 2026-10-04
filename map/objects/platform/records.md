---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-03 @ 4ee284a
entity: packages/core/src/records.ts:359
---

# records

A record type: one SQL view (or rows from code) declared as typed fields, saved views, related types, actions and an optional detail loader. `serveRecords` answers list, get, export and stats from the declaration alone; the portal's List, Record, Queue and Overview templates read it.

## Why this shape

A page is a declaration, not hand-built SQL or UI. Every column, op and sort comes from a fixed kind (`KINDS`, `packages/core/src/records.ts:49`), so a request can only pick names the type declared and every value is bound. The demo answers through the mask and never filters, sorts or searches anything that could spell a name (`allowed`, `:425`).

## Shape

- `defineRecord({id, name, view | rows, key, title, subtitle?, fields, views, related?, activity?, actions?, load?})` checks keys, identifiers, states and views up front (`packages/core/src/records.ts:359`); a saved view's `at` names the date its stats count by
- `rows: (db) => rows[]` instead of a view: read once per serve, then queried as `jsonb_to_recordset` with every column text, so filter, sort, page and count run the same SQL (`packages/core/src/records-serve.ts:317`). For rows that live outside Postgres: Restate loops, the roster
- kinds: text, name, company, status, number, money, percent, rate, date, verdict, score, link, cited; name and company are masked
- `serveRecords(types, db, mask?)` → `types()`, `list`, `get`, `export`, `stats` (`packages/core/src/records-serve.ts:301`); keyset paging on (sort value, key as text), page 50, limit capped at 200 (`:118`), export capped at 5000 (`:121`); a cursor carries its sort and is refused under another (`:297`)
- `stats({record, view?, where?, q?, of?, at?, period, sum?, zone?})` (`:505`): count or sum over this period so far, the same elapsed stretch of the one before, and a daily series. `period` is 1-92 days or `"month"`, days start at the zone's midnight (`statWindows`, `:138`); the same plan as list, so the demo's allowlist and mask hold, and it groups by day only
- Wren's types, team only on the main database through `ConsolePortal{recordsTypes,recordsList,recordsGet,recordsExport,recordsStats}` (`packages/core/src/console.ts:249`): `email.campaign`, `.inbox`, `.reply`, `.firm`, `.model` (`packages/channel-email/src/records.ts:273`), `books.spend`, `.subscription` (`packages/books/src/records.ts:75`), `console.client` (`packages/core/src/clients/index.ts:215`), `console.loop` (`packages/core/src/console.ts:153`); views `email_campaign_records`, `_reply_records`, `_reply_thread`, `_firm_records`, `_model_records` (`packages/channel-email/src/record-views.ts`), `books.spend_records`, `books.subscription_records`, `client_records` (migration 0061). Inbox rows come from the roster and policy, campaign rows merge the policy's opener cap and kill switch
- reactivation types `reactivation.person`, `.email`, `.finding` (`packages/reactivation/src/portal/records.ts:42`, `:95`, `:137`) over views `reactivation_people`, `_emails`, `_findings`, `_person_activity` (`packages/reactivation/src/portal/record-views.ts:17`, `:62`, `:96`, `:118`; migration 0060)
- drawn by `RecordList` and `RecordPage` (`packages/ui/src/records.tsx:483`, `:984`) and `RecordQueue` (`packages/ui/src/queue.tsx:40`: items left, the open one right, next opens after each action): views as tabs, a chip per filterable field, sort, columns, CSV, J/K, a side panel or full page with details, related, activity and sources; each kind's cell, filter and line in `packages/ui/src/fields.tsx`
- a portal page is `{template: "list" | "queue", record, empty?, columns?, actions?, extras?, head?, legacy?}` or `{template: "overview", tiles, top?}` (`apps/portal/web/src/module.ts`); `TemplatePage` gives it the record calls, the actions and the address (`apps/portal/web/src/records.tsx`). People is a List, Emails a Queue (`apps/portal/web/src/modules/reactivation/index.ts`, `email.tsx`)
- `RecordOverview` (`packages/ui/src/overview.tsx`): a tile with a period reads `stats` (this period, the one before, a bar a day); one without counts the view's rows now. Each tile links to its rows, narrowed to the period's days by the view's `at`. Top lists show a view's first 5 rows
- Wren's workspace (`apps/portal/web/src/modules/wren/index.ts`): Outbound, Inbox (a Queue on `email.reply`), Loops, Money, Pipeline and Clients, team only, each an Overview then its lists, all served by `console`. Actions that take one record (`email.approve`, `.drop`, `.pause`, `.resume`, `console.startLoop`, `.stopLoop`) are called once per id by `ONE` in `records.tsx`, which answers `{done, skipped}`
- actions: `{handler, key?, bulk?, undo?, when?, sets?, confirm?, ask?}`; input `{ids}`, answer `{done, skipped}`; `useRun` confirms or asks for text, or runs then offers Undo for 10s (`packages/ui/src/action.tsx`). `ask.from` prefills the text from a field; E opens the first action that asks when no action is keyed E. Email has approve (undo `unapprove`, `packages/reactivation/src/approve.ts`) and skip (confirms)
- demo: `localRecords` lays each action's `sets` over the server's rows in the browser; a reload resets (`packages/ui/src/records-local.ts:29`). The server refuses the writes for a demo viewer or the demo client (`PORTAL_WRITES`, `packages/reactivation/src/portal/routes.ts:24`)
- served as `ReactivationPortal{recordsTypes,recordsList,recordsGet,recordsExport,recordsStats}` in a read-only transaction (`packages/reactivation/src/portal/service.ts:98`, `:168`); open on the demo (`packages/reactivation/src/portal/routes.ts:16`)

Citations: `packages/core/src/records.ts:359`, `packages/core/src/records-serve.ts:301`, `packages/reactivation/src/portal/records.ts:160`, `packages/channel-email/src/records.ts:273`

## Connected to

- **owns:** the four reactivation record views, the eight console record views
- **joins:** [[reactivation/crm-contact]] (people come from it), [[platform/db-schema]] (views ride the migrations into every client database), [[platform/loop-object]] (`console.loop`), [[email/roster]] and [[email/send-policy]] (inbox and campaign rows), [[email/sender-pause]] (inbox pause/resume actions)
- **looks-like-but-is-not:** `ConsolePortal.view` (Wren's team reads an allowed view whole, no declaration, no mask)

## If you change this

- **Hits:** a field kind's ops or CSV changes every type's filters and exports; a view's SQL needs a migration (`pnpm --filter @wren/db generate`); console views read base tables only, so a later change to another view never has to drop them; `score.ts` fragments (`whereFinding`, `hiringFinding`) are inlined in `reactivation_people`, so changing them regenerates it; the portal web reads `recordsTypes`
- **Hits (web):** a kind the renderers don't know shows as text; a field's `column.width` sets its share of the table; the address keeps `view`, filters by field key, `q`, `sort`, `cols`, `after` and the open record (by `name.one`), so renaming a key breaks saved links
- **Does not hit:** the old `emails` handler (kept; its mask tests cover the email detail) and `replies`, which still serves its page. The old `people` handler is gone; `?filter=` links rewrite to `view=all&now=`

## Surfaces

| Surface | Role |
|---|---|
| portal Worker (`/api/reactivation/records*`) | reads; the demo is edge-cached |
| portal Worker (`/api/console/records*`) | reads; the service refuses all but Wren's team |
| portal web | `TemplatePage` reads `recordsTypes`, lists, gets, exports and stats; no page code per type |

## See

- Source: `packages/core/src/records.ts`, `packages/core/src/records-serve.ts`, `packages/reactivation/src/portal/records.ts`, `packages/channel-email/src/records.ts`, `packages/books/src/records.ts`
- Tests: `packages/core/test/integration/records.test.ts`, `records-stats.test.ts`, `console-loops.test.ts`, `packages/core/src/records-serve.test.ts`, `packages/channel-email/test/integration/records.test.ts`, `packages/reactivation/test/integration/records-adversarial.test.ts`, `portal.test.ts` (demo writes refused, unapprove), `packages/ui/src/fields.test.ts`, `records-local.test.ts`, `overview.test.ts`, `action.test.ts`, `apps/portal/web/src/copy.test.ts`
- Design: `designs/2026-10-03-console-standard.md`

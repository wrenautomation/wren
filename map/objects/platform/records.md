---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-03 @ 4ee284a
entity: packages/core/src/records.ts:359
---

# records

A record type: one SQL view (or rows from code) declared as typed fields, saved views, related types, actions and an optional detail loader. `serveRecords` answers list, get, export and stats from the declaration alone; the console standard's tables, filters, CSV and Overview numbers read it.

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
- drawn by `RecordList` and `RecordPage` (`packages/ui/src/records.tsx:413`, `:884`): views as tabs, a chip per filterable field, sort, columns, CSV, J/K, a side panel or full page with details, related, activity and sources; each kind's cell, filter and line in `packages/ui/src/fields.tsx`
- a portal page is `{template: "list", record, empty?, columns?, extras?, legacy?}` (`apps/portal/web/src/module.ts:37`); `TemplatePage` gives it the four calls and the address (`apps/portal/web/src/records.tsx:31`). People is one (`apps/portal/web/src/modules/reactivation/index.ts`)
- served as `ReactivationPortal{recordsTypes,recordsList,recordsGet,recordsExport,recordsStats}` in a read-only transaction (`packages/reactivation/src/portal/service.ts:96`, `:168`); open on the demo (`packages/reactivation/src/portal/routes.ts:16`)

Citations: `packages/core/src/records.ts:359`, `packages/core/src/records-serve.ts:301`, `packages/reactivation/src/portal/records.ts:160`, `packages/channel-email/src/records.ts:273`

## Connected to

- **owns:** the four reactivation record views, the eight console record views
- **joins:** [[reactivation/crm-contact]] (people come from it), [[platform/db-schema]] (views ride the migrations into every client database), [[platform/loop-object]] (`console.loop`), [[email/roster]] and [[email/send-policy]] (inbox and campaign rows), [[email/sender-pause]] (inbox pause/resume actions)
- **looks-like-but-is-not:** `ConsolePortal.view` (Wren's team reads an allowed view whole, no declaration, no mask)

## If you change this

- **Hits:** a field kind's ops or CSV changes every type's filters and exports; a view's SQL needs a migration (`pnpm --filter @wren/db generate`); console views read base tables only, so a later change to another view never has to drop them; `score.ts` fragments (`whereFinding`, `hiringFinding`) are inlined in `reactivation_people`, so changing them regenerates it; the portal web reads `recordsTypes`
- **Hits (web):** a kind the renderers don't know shows as text; a field's `column.width` sets its share of the table; the address keeps `view`, filters by field key, `q`, `sort`, `cols`, `after` and the open record (by `name.one`), so renaming a key breaks saved links
- **Does not hit:** the old `emails`/`replies` portal handlers, which still serve those pages. The old `people` handler is gone; `?filter=` links rewrite to `view=all&now=`

## Surfaces

| Surface | Role |
|---|---|
| portal Worker (`/api/reactivation/records*`) | reads; the demo is edge-cached |
| portal Worker (`/api/console/records*`) | reads; the service refuses all but Wren's team |
| portal web | `TemplatePage` reads `recordsTypes`, lists, gets and exports; no page code per type |

## See

- Source: `packages/core/src/records.ts`, `packages/core/src/records-serve.ts`, `packages/reactivation/src/portal/records.ts`, `packages/channel-email/src/records.ts`, `packages/books/src/records.ts`
- Tests: `packages/core/test/integration/records.test.ts`, `records-stats.test.ts`, `console-loops.test.ts`, `packages/core/src/records-serve.test.ts`, `packages/channel-email/test/integration/records.test.ts`, `packages/reactivation/test/integration/records-adversarial.test.ts`, `packages/ui/src/fields.test.ts`
- Design: `designs/2026-10-03-console-standard.md`

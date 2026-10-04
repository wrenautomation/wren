---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-03 @ 767bd96
entity: packages/core/src/records.ts:351
---

# records

A record type: one SQL view declared as typed fields, saved views, related types, actions and an optional detail loader. `serveRecords` answers list, get and export from the declaration alone; the console standard's tables, filters and CSV read it.

## Why this shape

A page is a declaration, not hand-built SQL or UI. Every column, op and sort comes from a fixed kind (`KINDS`, `packages/core/src/records.ts:49`), so a request can only pick names the type declared and every value is bound. The demo answers through the mask and never filters, sorts or searches anything that could spell a name (`allowed`, `:414`).

## Shape

- `defineRecord({id, name, view, key, title, subtitle?, fields, views, related?, activity?, actions?, load?})` checks keys, identifiers, states and views up front (`packages/core/src/records.ts:351`)
- kinds: text, name, company, status, number, money, percent, rate, date, verdict, score, link, cited; name and company are masked
- `serveRecords(types, db, mask?)` → `types()`, `list`, `get`, `export` (`packages/core/src/records-serve.ts:240`); keyset paging on (sort value, key as text), page 50, limit capped at 200 (`:84`), export capped at 5000 (`:86`); a cursor carries its sort and is refused under another (`:217`)
- reactivation types `reactivation.person`, `.email`, `.finding` (`packages/reactivation/src/portal/records.ts:42`, `:95`, `:137`) over views `reactivation_people`, `_emails`, `_findings`, `_person_activity` (`packages/reactivation/src/portal/record-views.ts:17`, `:62`, `:96`, `:118`; migration 0060)
- served as `ReactivationPortal{recordsTypes,recordsList,recordsGet,recordsExport}` in a read-only transaction (`packages/reactivation/src/portal/service.ts:100`, `:170`); open on the demo (`packages/reactivation/src/portal/routes.ts:16`)

Citations: `packages/core/src/records.ts:351`, `packages/core/src/records-serve.ts:240`, `packages/reactivation/src/portal/records.ts:160`

## Connected to

- **owns:** the four reactivation record views
- **joins:** [[reactivation/crm-contact]] (people come from it), [[platform/db-schema]] (views ride the migrations into every client database)
- **looks-like-but-is-not:** `ConsolePortal.view` (Wren's team reads an allowed view whole, no declaration, no mask)

## If you change this

- **Hits:** a field kind's ops or CSV changes every type's filters and exports; a view's SQL needs a migration (`pnpm --filter @wren/db generate`); `score.ts` fragments (`whereFinding`, `hiringFinding`) are inlined in `reactivation_people`, so changing them regenerates it; the portal web reads `recordsTypes`
- **Does not hit:** the old `people`/`emails` portal handlers, which still serve today's pages

## Surfaces

| Surface | Role |
|---|---|
| portal Worker (`/api/reactivation/records*`) | reads; the demo is edge-cached |
| portal web | reads `recordsTypes` and the cells |

## See

- Source: `packages/core/src/records.ts`, `packages/core/src/records-serve.ts`, `packages/reactivation/src/portal/records.ts`
- Tests: `packages/core/test/integration/records.test.ts`, `packages/reactivation/test/integration/records-adversarial.test.ts`
- Design: `designs/2026-10-03-console-standard.md`

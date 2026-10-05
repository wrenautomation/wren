---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-05 @ f1187d6
entity: apps/worker/src/services.ts:110
---

# restate-services

The set of services one worker serves, built by `buildServices` from settings. The names are the contract with Restate Cloud: rename one and every ingress URL and CLI call breaks.

## Why this shape

One composition root wires db, llm, verifier, transport, notifier, roster, box wake and the per-niche `Campaign`s, then binds a service only when its settings exist (`services.ts:105`–`337`). Nothing below the root imports a registry.

## Shape

- always: `Discovery`, `Enrichment`, `Resolution`, `SendScheduler`, `InboxScheduler`, `InboxPush`, `Disposition`, `PoolScheduler`, `PlacementScheduler` (idle until `WREN_PLACEMENT_SEEDS`), `Ads`, `AdsWatch`, `ContentDesk`, `ContentScheduler`, `ContentMetrics`, `ContentPlanner`, `TokenRenewal`, `SmsSender`, `SmsEvents`, `SmsDesk`, `SmsWatch`, `SmsConsole` (portal app `texts`), `Evolution`, `CallBookings`
- conditional: `ComposeScheduler` (compose days ahead > 0), `DigestScheduler` (notify), `PostmasterScheduler`, `OpensScheduler`, `ReportScheduler`, `Content` (channels configured), `SearchWatch` + `SearchWeek` (`WREN_SEARCH_SITE` + `_ORIGIN`) (`:243`–`:292`)
- outside this repo, same Restate: autobrowse's `sites` (the box) and `desk` (the Mac; Reddit) (`packages/core/src/content/restate.ts:21-23`)
- plain handlers: `Discovery{discover,verify}`, `Enrichment{crawl,render,scan,extract,applyExtractions,pick,applyPicks,tagTestimonials,backfillCallRecords}`, `Resolution{build,queue,resolve,resolveNewDomains,verifyLeads}`, `Disposition{classify,status}`, `CallBookings{ingest}`, `ContentDesk{add,draft,redraft}`, `Content{publish,list,metrics,comments,reply,platforms}`, `Ads{accounts,campaigns,insights,interests,launch,leadForm,leadForms,leads,start,stop}`, `SmsDesk`/`SmsEvents{addContact,enroll,ingest,label,lift,markRead,numbers,pause,reply,resume,stats,syncNumbers,thread,threads}`
- portal services are built with `portalService` (`packages/core/src/portal.ts:140`): each handler sits behind `guard` (`:105`), which reads the caller's role fresh and checks the route's need from its routes map (`DELIVERY_ROUTES`, `PORTAL_ROUTES`, `CONSOLE_ROUTES` in `packages/core/src/console-routes.ts`, `EMAIL_CONSOLE_ROUTES`, `BOOKS_CONSOLE_ROUTES`); a route with no need fails `apps/portal/test/inventory.test.ts`
- console (Wren's team, and a client's people for their own catalog, look and asks; the portal Worker refuses the writes on the demo): `ConsolePortal{view,loops,setLoop,addClient,call,setLook,install,configure,uninstall,ask,recordsTypes,recordsList,recordsGet,recordsExport,recordsStats}` (`packages/core/src/console.ts`; `call` runs any public non-Portal handler by its form, the effect's name typed in, one runs row each, and a handler with an effect needs `effect`; Money records and cost views need `money`), `EmailConsole{answers,approve,drop,pause,resume,setCampaign,killSwitchOn,killSwitchOff,stopOpeners,resumeOpeners,...}` (kill switch and opener stops need `effect`) (`packages/channel-email/src/restate/console.ts`), `BooksConsole{setAccount}` (`packages/books/src/console.ts`)

Citations: `apps/worker/src/services.ts:110`

## Connected to

- **owns:** every [[platform/loop-object]]
- **joins:** [[platform/worker]] (serves them), [[platform/settings]] (decides what binds), Restate Cloud registration (`.github/workflows/deploy.yml:47`)

## If you change this

- **Hits:** `docs/restate-operations.md`, `walkthrough/04-production.md`, `apps/cli` (calls by name), `apps/phone/src/worker.ts` (`SmsEvents`, `SmsDesk` by name), `scripts/register-worker.sh`
- **Does not hit:** the database schema

## Surfaces

| Surface | Role |
|---|---|
| Restate Cloud | invokes |
| CLI, phone Worker | call by name |

## See

- Source: `apps/worker/src/services.ts`

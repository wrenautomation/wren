---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-17 @ 729c7226
entity: apps/worker/src/services.ts:80
---

# restate-services

The set of services one worker serves, built by `buildServices` from settings. The names are the contract with the runtime (`rt.handlers`, the door's paths): rename one and every door URL and CLI call breaks. Written with the Restate SDK's definitions; the runtime reads them (`packages/runtime/src/pg/registry.ts`).

## Why this shape

One composition root wires db, llm, verifier, transport, notifier, roster, box wake and the per-niche `Campaign`s, then binds a service only when its settings exist (`services.ts:80`: the shared objects in `services/deps.ts:227`, each domain's bindings in `services/<domain>.ts`). Nothing below the root imports a registry.

## Shape

- always: `JourneyMove{open,move,drop,rebuild}` and `PipelineConsole` (the journey moves and the pipeline records; see [[platform/journey]]), `CompanySiteFind`, `CompanyEnrich`, `LeadVerify`, `EmailSend`, `EmailInboxRead`, `InboxPush`, `ReplyLabel`, `LeadPoolFill`, `EmailPlacementTest` (idle until `WREN_PLACEMENT_SEEDS`), `Ads`, `AdSpendGuard`, `ContentDesk`, `MarketingConsole` (a client's portal app `marketing`), `DraftAsk`, `PostPublish`, `PostMetrics`, `PostPlan`, `SiteTokenRenew`, `VaultKeyMirror` (the operator's API keys mirrored hourly, [[platform/vault-key]]), `SmsSend`, `SmsWebhookIntake`, `SmsDesk`, `SmsUpkeep`, `SmsApplicationFollowUp` (the lander's application push, [[sms/speed-run]]), `SmsConsole` (portal app `texts`), `CallBookingIntake`, `SignupForm`, `Newsletter` (object, one per issue; lists and campaigns in Listmonk once `WREN_LISTMONK_URL`/`_USER`/`_TOKEN` are set, [[leads/consent]]), `ListmonkIntake` (Listmonk's postback door, loopback on the box), `ListmonkMail` (object, one per campaign and recipient), `NewsletterSync` (loop, hourly; waits while Listmonk is unset), `BookingPage` + `ClientBookingPage` (a client's booking page, through the portal Worker) + `CalendarConsole` (portal app `calendar`, [[calendar/booking]]), `PeopleConsole` (portal app `people`, [[leads/sent-log]], [[leads/broadcast]]), `Broadcast` (object, one per broadcast), `ProfileResearch` (object, one per profile: `run({lookupId})` carries out one "Research this person" run, [[leads/profile]])
- conditional: `EmailOpenerFill` (compose days ahead > 0), `EmailFleetDigest` (notify), `EmailPostmasterPull`, `EmailClickPull` (`WREN_SITE_EXPORT_TOKEN`), `Content` (channels configured), `SiteRollup` (always bound, stopped; stops itself without `WREN_SITE_EXPORT_TOKEN`) (`:243`–`:292`)
- outside this repo, same door: autobrowse's `sites` (the box) and `desk` (the Mac; Reddit) (`packages/core/src/autobrowse/restate.ts:30-32`)
- plain handlers: `CompanySiteFind{discover,verify}`, `CompanyEnrich{crawl,render,scan,extract,applyExtractions,pick,applyPicks,tagTestimonials,backfillCallRecords}`, `LeadVerify{build,queue,resolve,resolveNewDomains,verifyLeads}`, `ReplyLabel{classify,status}`, `CallBookingIntake{ingest}`, `SignupForm{signUp,confirm,prefs,set}` ([[leads/consent]]), `ContentDesk{add,draft,redraft,approve,reject,edit,approveVideo,pickThumbnail}`, `DraftAsk{set,ask,undo}` (+ private `answer`: the console's draft box saves his words through `set` (only over the text it started from) and asks Claude through the desk's `claude`, `packages/starling/inbound/src/restate/draft-ask.ts`), `ContentPublish{publish,list,metrics,comments,reply,platforms}`, `Ads{accounts,campaigns,insights,interests,launch,leadConsents,leadForm,leadForms,leads,start,stop}`, `SmsDesk`/`SmsWebhookIntake{addContact,enroll,ingest,label,lift,markRead,numbers,pause,reply,resume,stats,syncNumbers,thread,threads}`
- portal services are built with `portalService` (`packages/core/src/portal.ts:140`): each handler sits behind `guard` (`:105`), which reads the caller's role fresh and checks the route's need from its routes map (`DELIVERY_ROUTES`, `PORTAL_ROUTES`, `CONSOLE_ROUTES` in `packages/core/src/console-routes.ts`, `EMAIL_CONSOLE_ROUTES`, `BOOKS_CONSOLE_ROUTES`); a route with no need fails `apps/portal/test/inventory.test.ts`
- console (Wren's team, and a client's people for their own catalog, look and asks; the portal Worker refuses the writes on the demo): `ConsolePortal{view,loops,setLoop,addClient,call,setLook,install,configure,uninstall,ask,teamSet,teamRemove,recordsTypes,recordsList,recordsGet,recordsExport,recordsStats}` (`packages/core/src/console/console-portal.ts`; `call` runs any public non-Portal handler by its form, the effect's name typed in, one runs row each, and a handler with an effect needs `effect`; Money records and cost views need `money`), `EmailConsole{answers,approve,drop,pause,resume,setCampaign,killSwitchOn,killSwitchOff,stopOpeners,resumeOpeners,...}` (kill switch and opener stops need `effect`) (`packages/starling/outbound/src/email/restate/console.ts`), `BooksConsole{setAccount}` (`packages/books/src/console.ts`)

Citations: `apps/worker/src/services.ts:80`, `apps/worker/src/services/deps.ts:227`

## Connected to

- **owns:** every [[platform/loop-object]]
- **joins:** [[platform/worker]] (serves them), [[platform/settings]] (decides what binds), each box slot writes what it serves to `rt.handlers` at start (`apps/worker/src/rt.ts:155`)

## If you change this

- **Hits:** `docs/operations.md`, `walkthrough/04-production.md`, `apps/cli` (calls by name), `apps/phone/src/worker.ts` (`SmsWebhookIntake`, `SmsDesk` by name)
- **Does not hit:** the database schema

## Surfaces

| Surface | Role |
|---|---|
| runtime dispatcher (box) | invokes |
| CLI, phone Worker | call by name |

## See

- Source: `apps/worker/src/services.ts`

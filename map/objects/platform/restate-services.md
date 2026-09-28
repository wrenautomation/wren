---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: apps/worker/src/services.ts:106
---

# restate-services

The set of services one worker serves, built by `buildServices` from settings. The names are the contract with Restate Cloud: rename one and every ingress URL and CLI call breaks.

## Why this shape

One composition root wires db, llm, verifier, transport, notifier, roster, box wake and the per-niche `Campaign`s, then binds a service only when its settings exist (`services.ts:106`–`334`). Nothing below the root imports a registry.

## Shape

- always: `Discovery`, `Enrichment`, `Resolution`, `SendScheduler`, `InboxScheduler`, `Disposition`, `PoolScheduler`, `LinkedinInbox`, `Ads`, `AdsWatch`, `ContentDesk`, `ContentScheduler`, `ContentMetrics`, `ContentPlanner`, `TokenRenewal`, `SmsSender`, `SmsEvents`, `SmsDesk`, `SmsWatch`
- conditional: `ComposeScheduler` (compose days ahead > 0), `DigestScheduler` (notify), `PostmasterScheduler`, `OpensScheduler`, `ReportScheduler`, `Content` (channels configured) (`:243`–`:292`)
- outside this repo, same Restate: autobrowse's `sites` (`packages/core/src/content/restate.ts:21`)
- plain handlers: `Discovery{discover,verify}`, `Enrichment{crawl,render,scan,extract,applyExtractions,pick,applyPicks,tagTestimonials,backfillCallRecords}`, `Resolution{build,queue,resolve,resolveNewDomains,verifyLeads}`, `Disposition{classify,status}`, `LinkedinInbox{add,ingest}`, `ContentDesk{add,draft,redraft}`, `Content{publish,list,metrics,comments,reply,platforms}`, `Ads{accounts,campaigns,insights,interests,launch,leadForm,leadForms,leads,start,stop}`, `SmsDesk`/`SmsEvents{addContact,enroll,ingest,label,lift,markRead,numbers,pause,reply,resume,stats,syncNumbers,thread,threads}`

Citations: `apps/worker/src/services.ts:106`

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

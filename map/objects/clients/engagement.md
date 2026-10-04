---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-04 @ d6098e4
entity: packages/delivery/src/schema.ts:33
---

# engagement

One offer we sell to one client, with dates (schema `delivery` in main). It carries the plan's steps (`milestones`), the timeline (`updates`), deliverables, asks and results. The portal's Home reads all of it.

## Why this shape

It sits in main, beside the registry, so an operator can read across clients and the client's own database stays product data. Every row hangs off the engagement and the engagement hangs off the client, so deleting the client deletes everything. Every write names the client, and another client's id comes back as "not found". Internal and hidden updates are filtered in one place (`seenBy`); an operator viewing as the client (`asClient`, `seesInternal` in core) gets the client's filter.

## Shape

- Tables: `engagements`, `milestones`, `updates`, `deliverables`, `asks`, `results` (`packages/delivery/src/schema.ts:33`, `:61`, `:93`, `:130`, `:176`, `:209`)
- Planned dates never move. A slip moves only `due_on` and needs a reason.
- How it ends and where it came from (`schema.ts:47`, `:49`): `ended_on` is set the first time `setEngagementStatus` (`wren delivery engagement <state>`) makes it `done` and cleared by any other status (`index.ts:237`); `source_channel` and `source_campaign` say how the client came in (null is unknown), set by `setEngagementSource` (`index.ts:253`) from `wren delivery source`, which suggests one from the lander's first touch on a member's application and a member's campaign replies (`sourceHints`, `touchSource`, `packages/delivery/src/source.ts:61`, `:35`; email's tables read by name). Unit economics reads these for churn and per-channel CAC.
- A new deliverable version is a new row pointing at the old one (`previous_id`). Home shows only the latest.
- `startEngagement` turns the offer's `plan` into dated steps and opens its asks (`packages/delivery/src/index.ts:139`, `datedPlan` `:129`)
- Writes: `postUpdate`, `hideUpdate`, `addDeliverable`, `decideDeliverable`, `addAsk`, `answerAsk`, `markDone`, `slipMilestone`, `recordResult` (`:207`–`:383`)
- Reads: `deliveryHome`, `timeline`, both through `seenBy` (`:465`, `:576`, `:410`)
- Input checks at the edge: https links only, Loom links on a Loom host, files only under `clients/<id>/` (`:63`, `:76`)
- Files: private bucket (`deploy/terraform/files.tf`); `upload` signs a PUT for one listed type and the exact size, `file` signs a short GET (`packages/delivery/src/files.ts`, types and cap in `routes.ts`)
- Portal service `DeliveryPortal` (`packages/delivery/src/service.ts:253`). Clients may `answer`, `decide` and `comment`. Everything else is team-only. Writes go in one transaction under `setAuditActor` (`:81`).
- Mail and pulse (step 5): `member_mail` (each person's level and what we've told them), `pulses` (one tap a week per person), `pings` (what the operator was told) (`schema.ts:245`, `:269`, `:298`); `recordPulse`, `setMailLevel` (`index.ts:414`, `:438`). Only the client's own people rate or set their mail.
- Products fill results: reactivation writes contacts reached, replies and meetings (with the bill as the note) and a daily timeline line, as author `reactivation` (`packages/reactivation/src/delivery.ts:94`, [[processes/reactivation-pass]]).
- Comments (`comments`, `schema.ts:321`): a thread under a client-visible update or a deliverable, from either side (`from_wren`). `addComment` (`index.ts:342`) refuses internal and hidden updates. A new deliverable version takes the thread with it. A client line with no Wren line after it pings us (`reply:<u|d><id>`); Wren's lines are mailed at level `all` ([[processes/delivery-watch]]).
- Invoices (`invoices`, `schema.ts:366`): what we billed through Wise, per engagement. Wise sends the invoice and takes the money; the row keeps its number (unique across clients), amount in cents, currency, dates, status and Wise link. `addInvoice`, `markInvoice` (`index.ts:541`, `:586`); `invoicesOf` reports an open one past its due day as `overdue` (`:922`). Only the account's owners and Wren read them (`service.ts:405`). One unpaid past its due day pings us (`invoice:<id>`).
- The account page (`account`, `service.ts:382`): the client's name, since when, what they bought (`boughtBy`, `index.ts:949`), people and owners, and billing counts for owners.
- Onboarding (`onboard`, `index.ts:675`): selling an offer opens the engagement as `onboarding`, issues the contract and asks for the offer's `access`. Steps show "next" and asks are never overdue until it starts. `startIfReady` (`:765`) makes it `active` once the contract is signed and the setup invoice (`invoices.setup`) is paid or there's no setup fee; undone steps and open asks move by the days waited, and the start becomes today if later.
- Agreements (`agreements`, `schema.ts:427`): one per engagement. The text (`contractText`, `contract.ts`) and terms (`termsFor`, `index.ts:640`) are frozen when issued, with their sha256. `signAgreement` (`:721`) takes the hash the signer read and refuses any other (409), keeps name, title, email, time, IP and browser. Only owners and Wren read it (`service.ts:429`); only an owner signs (`:456`), never an operator. DeliveryWatch mails the signed copy once (`mailed_at`).
- Access requests (`access_requests`, `schema.ts:472`): one system each, with scope, why and how to revoke. `requestAccess` (`:804`) for the team; the client answers granted, declined (with a note) or revoked (`answerAccess`, `:825`).
- Who sees which client: `pickClient` / `pickForWrite` (`packages/core/src/portal.ts:51`, `:63`). These are shared with every product's portal service.

Citations: `packages/delivery/src/schema.ts:33`, `packages/delivery/src/index.ts:139`, `packages/delivery/src/service.ts:81`, `packages/core/src/portal.ts:51`

## Connected to

- **owned-by:** [[clients/client]] (cascade)
- **joins:** [[platform/offer]] (`plan`, `measures`), [[clients/client-member]] (who reads it), [[platform/audit-log]] (every table audited)
- **looks-like-but-is-not:** [[reactivation/handoff]] (a product's per-meeting record; it may post into delivery, never the other way)

## If you change this

- **Hits:** the portal's Home and its Worker route list (`packages/delivery/src/routes.ts`), the worker's service list (`apps/worker/src/services.ts:414`), [[processes/migrate]], the `books.econ_*` views (they read `engagements`, `invoices` and `agreements` by name; a renamed column fails `packages/books/test/integration/economics.test.ts`)
- **Does not hit:** client databases. Products import delivery; delivery imports no product.

## Surfaces

| Surface | Role |
|---|---|
| app.wrenautomation.com `/api/delivery/*` | reads; clients answer and decide; operators write the rest |
| demo host | reads the demo client's sample, writes nothing |
| portal engagement kit (`apps/portal/web/src/modules/work/`: `ENGAGEMENT_PAGES` + `EngagementBar` inside each product app; the `work` app "Your project" for offers with no `app`) | the client's pages: Paperwork, the contract (hidden tab, signs and prints) and the welcome guide (hidden tab) first; operators write in place, "view as client" drops internal |
| portal `account` module (`apps/portal/web/src/modules/account/`) | from the client's name at top left: overview, people, each person's mail level and sign-in, billing |
| `wren --client <id> delivery …` (`apps/cli/src/delivery.ts`) | the team's writes from the terminal and the skill; `onboard`, `contract`, `access` for the paperwork; `deliver --file` uploads; `invoice [--setup]`, `paid`, `void` track Wise invoices |
| S3 files bucket (`WREN_FILES_BUCKET`) | the bytes; the browser PUTs and GETs on signed URLs |
| [[processes/delivery-watch]] | mails the client's people, pings the operator |

## See

- Design: `designs/2026-09-30-client-delivery-portal.md`
- Tests: `packages/delivery/test/integration/delivery.test.ts`, `watch.test.ts`, `onboarding.test.ts`

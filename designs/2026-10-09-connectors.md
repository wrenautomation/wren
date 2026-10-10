# Connectors: a client's own apps feed its CRM (2026-10-09)

## Answer first

A client connects HubSpot, QuickBooks or Jobber on Account → Connectors with one sign-in. Every
hour Wren reads what changed, read-only. People land in the client's CRM through the same import
a CSV export takes (`runCrmImport`). What happened fires the spine's new App trigger: a contact
added, an invoice paid, a job done. So a workflow can ask for a review when a job is done.

No Nango or Composio: three apps, one OAuth shape, one thin package. The social layer
(`content/connect`) is the model, minus posting.

## Shape

| What | Where |
|---|---|
| The apps: sign-in URLs, scopes, how each reads | `packages/connectors/src/apps.ts` |
| Sign-ins in flight, connected apps, what each told the spine (main) | `connector_grants`, `connector_links`, `connector_fired` (0221) |
| Sign-in, exchange, refresh | `packages/connectors/src/oauth.ts` |
| Reads per app | `packages/connectors/src/pull/{hubspot,quickbooks,jobber}.ts` |
| A sync: pull, import, fire, keep the cursor | `packages/connectors/src/sync.ts` |
| Into the CRM (a product, so passed in by the worker) | `packages/reactivation/src/crm/landing.ts` |
| `Connectors` (portal), `ConnectorCallback/land`, `ConnectorSync/<link>` (hourly) | `packages/connectors/src/restate.ts` |
| `/oauth/connector/<app>` | `apps/portal/src/connector-oauth.ts` |
| Account → Connectors | `apps/portal/web/src/modules/account/Connectors.tsx` |
| App trigger | `packages/core/src/logic.ts` `trigger.app` |

- **Tokens** sit in the key store under the client, as social tokens do. A link names its ref.
  QuickBooks and Jobber rotate the refresh token on each use, so every refresh writes the new
  one back. `ConnectorSync` is a virtual object per link, so two refreshes never race.
- **Reads:**
  - HubSpot: contacts changed since the cursor (CRM search on `lastmodifieddate`).
  - QuickBooks: customers and invoices by `Metadata.LastUpdatedTime`.
  - Jobber: clients and jobs by `updatedAt`.
  - 100 a page, 2000 a run. The cursor is the newest change seen, so the next run picks up
    the rest. Jobber pages in its own order, so a cut walk keeps its page and its `since`.
  - A read the app refuses for the token breaks the link. Any other failure says why on the
    page and tries again next hour.
- **Into the CRM:** rows go through `CrmCsvSource` as a CSV with generic headers. The format is
  the app's name, so `crm_contacts` keys on the app's own id, and a CSV export and the live read
  of the same HubSpot contact are one row. A household with no company is its own account: the
  company is the customer's name. That's how home services keep customers.
- **Events** fire as `trigger.app` with `{app, change}`:
  - `contact_added`: a record first seen.
  - `invoice_paid`: a QuickBooks invoice whose balance went to 0.
  - `job_done`: a Jobber job with `completedAt` set.
  Each is about the person's email and phone, so a Wait or a lead finds them. Nothing from
  before the link was made fires: history isn't news. Each change fires once
  (`connector_fired`).
- **States:** Needs setup (no Wren app keys), Not connected, Connected, Broken (with why).
  Disconnect deletes the token and stops the sync.
- **Who:** `act` on the Account app connects and disconnects; `read` sees it.

## Not now

- Marketplace listings for the three apps: a publish, held.
- Writing back (a note in HubSpot, a job in Jobber).
- Webhooks from the apps. Hourly reads are enough until a client needs minutes.
- Salesforce, ServiceTitan, Housecall Pro, Shopify.

## Setup (mine)

Each app needs a developer app with Wren's callback, its id and secret kept as
`CONNECTOR_<APP>_ID` and `CONNECTOR_<APP>_SECRET` in the key store under Wren. Until then the
page says Needs setup. Done 10-09: HubSpot project app, Intuit production keys, Jobber app (draft);
keys in `/wren/prod/env-2` as `WREN_CONNECTOR_*`. Test accounts: HubSpot developer test account
343773626, a Jobber developer testing account (90 days). QuickBooks has no live connect yet: its
production keys need a real QuickBooks Online company.

## Log

- 10-09: one package, no vendor. The CRM import is the one way people land.
- 10-10: first live connects from wren_test. HubSpot connected and read its 2 sample contacts.
  Jobber connected, then failed its first read: `JobFilterAttributes` has no `updatedAt`. Jobs now
  page by `completedAt` (introspected on the test account); clients keep `updatedAt`; re-read
  clean after deploy. QuickBooks: the pull ran locally against Intuit's sandbox company (dev keys,
  playground token, host swapped): 29 customers, 11 paid invoices, a second run read nothing new.
  No live QuickBooks connect until a real company signs in. Both
  unverified-app screens (HubSpot's typed "I accept the risk", Jobber's not-yet-approved note) stay
  until each marketplace review.
- 10-09 built: package, 0221, App trigger, `app.changed` webhook event, Account → Connectors,
  `/oauth/connector/<app>`. The connectors package can't import reactivation (layers), so the
  worker passes `crmLanding`. Unbuilt app keys show "In development".

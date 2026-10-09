---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09
entity: packages/connectors/src/schema.ts:53
---

# connector

A client's own HubSpot, QuickBooks or Jobber, connected with one sign-in on Account → Connectors and read hourly, read-only (designs/2026-10-09-connectors.md). Tables `connector_grants`, `connector_links`, `connector_fired`, migration 0221.

## Why this shape

Three apps, one OAuth shape, so a thin package and no vendor (Nango, Composio). People land through the CRM import a CSV export takes, so a live read and an export of the same record are one `crm_contacts` row (format = the app's name).

## Shape

- `connector_links`: client, app, `external_id` (hub, realm, account), name, `token_ref` (key store, never the token), `extra` (QuickBooks realm), state connected|broken, why, `cursor` jsonb (newest change per read), counts, `synced_at`, `connected_at`. Unique (client, app, external_id).
- `connector_grants`: one sign-in's `state`, spent once, 30 minutes. `connector_fired`: (link, key) told to the spine once.
- Apps `packages/connectors/src/apps.ts` (no imports: the portal Worker reads it). OAuth `oauth.ts`: QuickBooks takes the app's keys as basic auth; QuickBooks and Jobber rotate the refresh token, kept at once (`connectors.ts` `tokenOf`).
- Reads `src/pull/{hubspot,quickbooks,jobber}.ts`: 100 a page, 2000 a run. Jobber's GraphQL names and version header (`JOBBER_VERSION`) are unverified until the first real connect.
- Sync `src/sync.ts` `syncLink`: pull, land (`CrmLanding`, the worker passes reactivation's `crmLanding`), fire `trigger.app` for changes after `connected_at`, once each. Token refused: broken. Other failures: `why` on the page, next hour.
- Services `src/restate.ts`: `Connectors` (portal: connectors, connect, syncNow, disconnect; `act` on Account), `ConnectorCallback/land`, `ConnectorSync/<link>` (exclusive, reschedules itself hourly, 5 minutes when cut at the cap; a Read now starts a new chain and the old one stops).
- Wren's developer apps: env `WREN_CONNECTOR_<APP>_ID|SECRET` or the key store under Wren. Missing: "In development" on the page.

Citations: `packages/connectors/src/sync.ts:1`, `packages/connectors/src/restate.ts:1`, `apps/portal/src/connector-oauth.ts:1`, `packages/core/src/logic.ts` (`trigger.app`)

## Connected to

- **owns:** `connector_grants`, `connector_links`, `connector_fired`
- **writes:** [[reactivation/crm-contact]] through the CRM import
- **fires:** [[platform/spine]] `trigger.app` (contact_added, invoice_paid, job_done), webhook event `app.changed`
- **looks-like-but-is-not:** client social (`social_connections`), which posts; connectors only read

## If you change this

- **Hits:** the client's CRM rows (format hubspot, quickbooks, jobber), the App trigger, Account → Connectors, `/oauth/connector/<app>`, key names `CONNECTOR_*` in `packages/core/src/key-refs.ts`.
- **Does not hit:** the apps themselves: nothing writes back.

## Surfaces

| Surface | Role |
|---|---|
| Account → Connectors | connect, read now, disconnect |
| `/oauth/connector/<app>` | the sign-in lands |
| a workflow's Connected app trigger | hears changes |

## See

- Source: `packages/connectors/src/`

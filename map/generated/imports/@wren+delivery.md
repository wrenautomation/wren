# @wren/delivery

Role: package. Files: 42.

## Uses

- @wren/core
- @wren/offers
- @wren/db
- @wren/pipeline
- @wren/books
- @wren/documents

## Outside packages

node:crypto, node:fs

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nfiles_ts["files.ts"]
  nroutes_ts["routes.ts"]
  nindex_ts["index.ts"]
  ncontract_ts["contract.ts"]
  nschema_ts["schema.ts"]
  ninvoices_ts["invoices.ts"]
  nonboarding_ts["onboarding.ts"]
  nrows_ts["rows.ts"]
  nwork_ts["work.ts"]
  ncomponents_ts["components.ts"]
  nmoments_ts["moments.ts"]
  nsource_ts["source.ts"]
  nviews_ts["views.ts"]
  nbilling_["billing/ (11)"]
  nwatch_ts["watch.ts"]
  nhealth_["health/ (10)"]
  nsample_ts["sample.ts"]
  nservice_ts["service.ts"]
  ndomains_ts["domains.ts"]
  nmessaging_ts["messaging.ts"]
  nrecords_ts["records.ts"]
  nwebhooks_ts["webhooks.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nfiles_ts --> nroutes_ts
  nindex_ts --> ncontract_ts
  nindex_ts --> ninvoices_ts
  nindex_ts --> nmoments_ts
  nindex_ts --> nonboarding_ts
  nindex_ts --> nrows_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsource_ts
  nindex_ts --> nviews_ts
  nindex_ts --> nwork_ts
  ncontract_ts -.-> nschema_ts
  ninvoices_ts --> ncontract_ts
  ninvoices_ts --> nonboarding_ts
  ninvoices_ts --> nrows_ts
  ninvoices_ts --> nschema_ts
  ninvoices_ts --> nwork_ts
  nonboarding_ts --> ncontract_ts
  nonboarding_ts --> nrows_ts
  nonboarding_ts --> nschema_ts
  nonboarding_ts --> nwork_ts
  nrows_ts --> nschema_ts
  nwork_ts --> ncomponents_ts
  nwork_ts --> nrows_ts
  nwork_ts --> nschema_ts
  nmoments_ts --> nrows_ts
  nmoments_ts --> nschema_ts
  nviews_ts --> nfiles_ts
  nviews_ts --> nmoments_ts
  nviews_ts --> nonboarding_ts
  nviews_ts --> nrows_ts
  nviews_ts --> nschema_ts
  nbilling_ --> nindex_ts
  nbilling_ --> nschema_ts
  nbilling_ --> ncontract_ts
  nbilling_ -.-> nwatch_ts
  nwatch_ts --> ncontract_ts
  nwatch_ts --> nhealth_
  nwatch_ts --> nindex_ts
  nwatch_ts --> nroutes_ts
  nwatch_ts --> nsample_ts
  nwatch_ts --> nschema_ts
  nhealth_ --> nschema_ts
  nhealth_ --> nindex_ts
  nsample_ts --> nindex_ts
  nsample_ts --> nschema_ts
  nservice_ts --> nbilling_
  nservice_ts --> ndomains_ts
  nservice_ts --> nfiles_ts
  nservice_ts --> nindex_ts
  nservice_ts --> nmessaging_ts
  nservice_ts --> nrecords_ts
  nservice_ts --> nroutes_ts
  nservice_ts --> nschema_ts
  nservice_ts --> nwatch_ts
  nservice_ts --> nwebhooks_ts
  nrecords_ts --> nbilling_
  nrecords_ts --> nindex_ts
  nrecords_ts --> nmessaging_ts
```

## Files

- billing/: src/billing/console-routes.ts, src/billing/console.ts, src/billing/credits.ts, src/billing/index.ts, src/billing/mail.ts, src/billing/match.ts, src/billing/receive.ts, src/billing/records.ts, src/billing/tell.ts, src/billing/watch.ts, src/billing/wise.ts
- components.ts
- contract.ts
- domains.ts
- files.ts
- health/: src/health/console-routes.ts, src/health/console.ts, src/health/flags.ts, src/health/hand.ts, src/health/index.ts, src/health/pass.ts, src/health/records.ts, src/health/schema.ts, src/health/score.ts, src/health/views.ts
- index.ts
- invoices.ts
- messaging.ts
- moments.ts
- onboarding.ts
- records.ts
- routes.ts
- rows.ts
- sample.ts
- schema.ts
- service.ts
- source.ts
- views.ts
- vitest.config.ts
- watch.ts
- webhooks.ts
- work.ts

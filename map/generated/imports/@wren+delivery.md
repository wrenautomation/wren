# @wren/delivery

Role: package. Files: 42.

## Uses

- @wren/books
- @wren/core
- @wren/db
- @wren/documents
- @wren/offers
- @wren/pipeline

## Outside packages

@aws-sdk/client-s3@3.1136.0, @aws-sdk/s3-request-presigner@3.1136.0, @restatedev/restate-sdk@1.17.1, drizzle-orm@0.45.2, node:crypto, node:fs, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nbilling_["billing/ (11)"]
  ncomponents_ts["components.ts"]
  ncontract_ts["contract.ts"]
  ndomains_ts["domains.ts"]
  nfiles_ts["files.ts"]
  nhealth_["health/ (10)"]
  nindex_ts["index.ts"]
  ninvoices_ts["invoices.ts"]
  nmessaging_ts["messaging.ts"]
  nmoments_ts["moments.ts"]
  nonboarding_ts["onboarding.ts"]
  nrecords_ts["records.ts"]
  nroutes_ts["routes.ts"]
  nrows_ts["rows.ts"]
  nsample_ts["sample.ts"]
  nschema_ts["schema.ts"]
  nservice_ts["service.ts"]
  nsource_ts["source.ts"]
  nviews_ts["views.ts"]
  nwatch_ts["watch.ts"]
  nwebhooks_ts["webhooks.ts"]
  nwork_ts["work.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nbilling_ --> nschema_ts
  nbilling_ --> nindex_ts
  nbilling_ --> ncontract_ts
  nbilling_ -.-> nwatch_ts
  ncontract_ts -.-> nschema_ts
  nfiles_ts --> nroutes_ts
  nhealth_ --> nindex_ts
  nhealth_ --> nschema_ts
  nindex_ts --> ncontract_ts
  nindex_ts --> ninvoices_ts
  nindex_ts --> nmoments_ts
  nindex_ts --> nonboarding_ts
  nindex_ts --> nrows_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsource_ts
  nindex_ts --> nviews_ts
  nindex_ts --> nwork_ts
  ninvoices_ts --> ncontract_ts
  ninvoices_ts --> nonboarding_ts
  ninvoices_ts --> nrows_ts
  ninvoices_ts --> nschema_ts
  ninvoices_ts --> nwork_ts
  nmoments_ts --> nrows_ts
  nmoments_ts --> nschema_ts
  nonboarding_ts --> ncontract_ts
  nonboarding_ts --> nrows_ts
  nonboarding_ts --> nschema_ts
  nonboarding_ts --> nwork_ts
  nrecords_ts --> nbilling_
  nrecords_ts --> nindex_ts
  nrecords_ts --> nmessaging_ts
  nrows_ts --> nschema_ts
  nsample_ts --> nindex_ts
  nsample_ts --> nschema_ts
  nservice_ts --> nbilling_
  nservice_ts --> ndomains_ts
  nservice_ts --> nfiles_ts
  nservice_ts -.-> nindex_ts
  nservice_ts --> nmessaging_ts
  nservice_ts --> nrecords_ts
  nservice_ts --> nroutes_ts
  nservice_ts -.-> nschema_ts
  nservice_ts --> nwatch_ts
  nservice_ts --> nwebhooks_ts
  nviews_ts --> nfiles_ts
  nviews_ts --> nmoments_ts
  nviews_ts --> nonboarding_ts
  nviews_ts --> nrows_ts
  nviews_ts --> nschema_ts
  nwatch_ts --> ncontract_ts
  nwatch_ts --> nhealth_
  nwatch_ts --> nindex_ts
  nwatch_ts --> nroutes_ts
  nwatch_ts --> nsample_ts
  nwatch_ts --> nschema_ts
  nwork_ts --> ncomponents_ts
  nwork_ts --> nrows_ts
  nwork_ts --> nschema_ts
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

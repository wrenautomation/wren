# @wren/payments

Role: package. Files: 12.

## Uses

- @wren/channel-sms
- @wren/core
- @wren/db

## Outside packages

@restatedev/restate-sdk@1.17.1, drizzle-orm@0.45.2, node:crypto, stripe@22.6.2, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  nreconcile_ts["reconcile.ts"]
  nrecords_ts["records.ts"]
  nschema_ts["schema.ts"]
  nservice_ts["service.ts"]
  nsetups_ts["setups.ts"]
  nstates_ts["states.ts"]
  nstore_ts["store.ts"]
  nstripe_ts["stripe.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ncomponents_ts --> nrecords_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nrecords_ts
  nconsole_ts -.-> nschema_ts
  nconsole_ts --> nservice_ts
  nconsole_ts --> nstore_ts
  nconsole_ts --> nstripe_ts
  nreconcile_ts -.-> nschema_ts
  nreconcile_ts --> nservice_ts
  nreconcile_ts --> nstates_ts
  nreconcile_ts --> nstore_ts
  nreconcile_ts --> nstripe_ts
  nrecords_ts --> nschema_ts
  nrecords_ts -.-> nstates_ts
  nschema_ts --> nstates_ts
  nservice_ts --> ncomponents_ts
  nservice_ts -.-> nschema_ts
  nservice_ts -.-> nstates_ts
  nservice_ts --> nstore_ts
  nservice_ts --> nstripe_ts
  nsetups_ts --> nstore_ts
  nstates_ts -.-> nstripe_ts
  nstore_ts --> nschema_ts
  nstore_ts --> nstates_ts
  nstore_ts --> nstripe_ts
```

## Files

- components.ts
- console-routes.ts
- console.ts
- reconcile.ts
- records.ts
- schema.ts
- service.ts
- setups.ts
- states.ts
- store.ts
- stripe.ts
- vitest.config.ts

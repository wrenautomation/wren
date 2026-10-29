# @wren/connectors

Role: package. Files: 12.

## Uses

- @wren/core
- @wren/db

## Outside packages

node:crypto

## Folders

Dotted: types only.

```mermaid
flowchart LR
  napps_ts["apps.ts"]
  nconnectors_ts["connectors.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nindex_ts["index.ts"]
  npull_["pull/ (4)"]
  nrestate_ts["restate.ts"]
  nschema_ts["schema.ts"]
  nsync_ts["sync.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nconnectors_ts --> napps_ts
  nconnectors_ts --> npull_
  nconnectors_ts --> nschema_ts
  nindex_ts --> napps_ts
  nindex_ts --> nconnectors_ts
  nindex_ts --> nrestate_ts
  nindex_ts --> nsync_ts
  npull_ -.-> nschema_ts
  nrestate_ts --> napps_ts
  nrestate_ts -.-> nconnectors_ts
  nrestate_ts --> nconsole_routes_ts
  nrestate_ts --> nsync_ts
  nschema_ts --> napps_ts
  nsync_ts -.-> napps_ts
  nsync_ts -.-> nconnectors_ts
  nsync_ts --> npull_
  nsync_ts --> nschema_ts
```

## Files

- apps.ts
- connectors.ts
- console-routes.ts
- index.ts
- pull/: src/pull/hubspot.ts, src/pull/jobber.ts, src/pull/quickbooks.ts, src/pull/types.ts
- restate.ts
- schema.ts
- sync.ts
- vitest.config.ts

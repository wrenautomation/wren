# @wren/documents

Role: package. Files: 12.

## Uses

- @wren/channel-sms
- @wren/core
- @wren/db
- @wren/payments

## Outside packages

node:crypto

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ndocumenso_ts["documenso.ts"]
  nlines_ts["lines.ts"]
  npdf_ts["pdf.ts"]
  nrecords_ts["records.ts"]
  nrender_ts["render.ts"]
  nschema_ts["schema.ts"]
  nservice_ts["service.ts"]
  nstore_ts["store.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ncomponents_ts --> nrecords_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> npdf_ts
  nconsole_ts --> nrecords_ts
  nconsole_ts -.-> nschema_ts
  nconsole_ts --> nservice_ts
  nconsole_ts --> nstore_ts
  npdf_ts -.-> nschema_ts
  npdf_ts --> nstore_ts
  nrecords_ts --> nschema_ts
  nrecords_ts --> nstore_ts
  nrender_ts -.-> nschema_ts
  nrender_ts --> nstore_ts
  nschema_ts --> nlines_ts
  nservice_ts --> ncomponents_ts
  nservice_ts --> ndocumenso_ts
  nservice_ts --> npdf_ts
  nservice_ts --> nrender_ts
  nservice_ts -.-> nschema_ts
  nservice_ts --> nstore_ts
  nstore_ts --> nlines_ts
  nstore_ts --> nschema_ts
```

## Files

- components.ts
- console-routes.ts
- console.ts
- documenso.ts
- lines.ts
- pdf.ts
- records.ts
- render.ts
- schema.ts
- service.ts
- store.ts
- vitest.config.ts

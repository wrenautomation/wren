# @wren/documents

Role: package. Files: 12.

## Uses

- @wren/core
- @wren/db
- @wren/payments
- @wren/channel-sms

## Outside packages

node:crypto

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nrecords_ts["records.ts"]
  nschema_ts["schema.ts"]
  nlines_ts["lines.ts"]
  nstore_ts["store.ts"]
  npdf_ts["pdf.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  nservice_ts["service.ts"]
  ndocumenso_ts["documenso.ts"]
  nrender_ts["render.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ncomponents_ts --> nrecords_ts
  nrecords_ts --> nschema_ts
  nrecords_ts --> nstore_ts
  nschema_ts --> nlines_ts
  nstore_ts --> nlines_ts
  nstore_ts --> nschema_ts
  npdf_ts -.-> nschema_ts
  npdf_ts --> nstore_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> npdf_ts
  nconsole_ts --> nrecords_ts
  nconsole_ts --> nschema_ts
  nconsole_ts --> nservice_ts
  nconsole_ts --> nstore_ts
  nservice_ts --> ncomponents_ts
  nservice_ts --> ndocumenso_ts
  nservice_ts --> npdf_ts
  nservice_ts --> nrender_ts
  nservice_ts -.-> nschema_ts
  nservice_ts --> nstore_ts
  nrender_ts -.-> nschema_ts
  nrender_ts --> nstore_ts
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

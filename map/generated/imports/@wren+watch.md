# @wren/watch

Role: package. Files: 12.

## Uses

- @wren/core
- @wren/db
- @wren/learn
- @wren/llm

## Outside packages

@restatedev/restate-sdk@1.17.1, drizzle-orm@0.45.2, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nclients_ts["clients.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  nindex_ts["index.ts"]
  nlinks_ts["links.ts"]
  nread_ts["read.ts"]
  nrecords_ts["records.ts"]
  nrestate_ts["restate.ts"]
  nschema_ts["schema.ts"]
  ntriage_ts["triage.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nclients_ts --> nread_ts
  nclients_ts --> ntriage_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nschema_ts
  nconsole_ts --> ntriage_ts
  nindex_ts --> nread_ts
  nindex_ts --> nschema_ts
  nindex_ts --> ntriage_ts
  nread_ts --> nlinks_ts
  nread_ts --> nschema_ts
  nrestate_ts --> nconsole_ts
  nrestate_ts --> nread_ts
  nrestate_ts --> ntriage_ts
  ntriage_ts --> nschema_ts
```

## Files

- clients.ts
- components.ts
- console-routes.ts
- console.ts
- index.ts
- links.ts
- read.ts
- records.ts
- restate.ts
- schema.ts
- triage.ts
- vitest.config.ts

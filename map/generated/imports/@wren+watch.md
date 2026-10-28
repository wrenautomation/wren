# @wren/watch

Role: package. Files: 12.

## Uses

- @wren/core
- @wren/db
- @wren/llm
- @wren/learn

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nindex_ts["index.ts"]
  nread_ts["read.ts"]
  nlinks_ts["links.ts"]
  nschema_ts["schema.ts"]
  ntriage_ts["triage.ts"]
  nrestate_ts["restate.ts"]
  nconsole_ts["console.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nrecords_ts["records.ts"]
  nclients_ts["clients.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> nread_ts
  nindex_ts --> nschema_ts
  nindex_ts --> ntriage_ts
  nread_ts --> nlinks_ts
  nread_ts --> nschema_ts
  ntriage_ts --> nschema_ts
  nrestate_ts --> nconsole_ts
  nrestate_ts --> nread_ts
  nrestate_ts --> ntriage_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nschema_ts
  nconsole_ts --> ntriage_ts
  nclients_ts --> nread_ts
  nclients_ts --> ntriage_ts
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

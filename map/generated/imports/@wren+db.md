# @wren/db

Role: package. Files: 16.

## Uses

- @wren/config

## Outside packages

@testcontainers/postgresql@12.1.0, drizzle-kit@0.31.10, drizzle-orm@0.45.2, node:async_hooks, node:crypto, node:fs, node:os, node:path, node:url, postgres@3.4.9, vitest@5.0.1

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ndrizzle_config_ts["drizzle.config.ts"]
  ndrizzle_drift_config_ts["drizzle.drift.config.ts"]
  naudit_["audit/ (4)"]
  nclients_ts["clients.ts"]
  ncolumns_ts["columns.ts"]
  nindex_ts["index.ts"]
  nisolation_ts["isolation.ts"]
  nlisten_ts["listen.ts"]
  nmigrate_cli_ts["migrate-cli.ts"]
  ntesting_global_setup_ts["testing-global-setup.ts"]
  ntesting_vitest_ts["testing-vitest.ts"]
  ntesting_ts["testing.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ndrizzle_drift_config_ts --> ndrizzle_config_ts
  naudit_ -.-> nindex_ts
  nclients_ts --> naudit_
  nclients_ts --> nindex_ts
  nindex_ts --> naudit_
  nindex_ts --> nclients_ts
  nindex_ts --> nisolation_ts
  nindex_ts --> nlisten_ts
  nisolation_ts -.-> nindex_ts
  nmigrate_cli_ts --> nclients_ts
  nmigrate_cli_ts --> nindex_ts
  ntesting_global_setup_ts --> ntesting_ts
  ntesting_ts --> nindex_ts
  nvitest_config_ts --> ntesting_vitest_ts
```

## Files

- audit/: src/audit/acting.ts, src/audit/index.ts, src/audit/install.ts, src/audit/schema.ts
- clients.ts
- columns.ts
- drizzle.config.ts
- drizzle.drift.config.ts
- index.ts
- isolation.ts
- listen.ts
- migrate-cli.ts
- testing-global-setup.ts
- testing-vitest.ts
- testing.ts
- vitest.config.ts

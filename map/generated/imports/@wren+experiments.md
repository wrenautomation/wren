# @wren/experiments

Role: package. Files: 7.

## Outside packages

node:crypto, vitest@5.0.1, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nengine_ts["engine.ts"]
  nindex_ts["index.ts"]
  nnames_ts["names.ts"]
  nrng_ts["rng.ts"]
  nsettings_ts["settings.ts"]
  nsimulate_ts["simulate.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nengine_ts -.-> nsettings_ts
  nindex_ts --> nengine_ts
  nindex_ts --> nrng_ts
  nindex_ts --> nsettings_ts
  nindex_ts --> nsimulate_ts
  nsettings_ts --> nnames_ts
  nsimulate_ts --> nengine_ts
  nsimulate_ts --> nrng_ts
  nsimulate_ts --> nsettings_ts
```

## Files

- engine.ts
- index.ts
- names.ts
- rng.ts
- settings.ts
- simulate.ts
- vitest.config.ts

# @wren/offers

Role: package. Files: 9.

## Outside packages

node:fs, node:path, vitest@5.0.1

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncatalog_["catalog/ (3)"]
  nexport_cli_ts["export-cli.ts"]
  nindex_ts["index.ts"]
  noffer_ts["offer.ts"]
  nsnapshot_ts["snapshot.ts"]
  nterms_ts["terms.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ncatalog_ --> noffer_ts
  nexport_cli_ts --> nindex_ts
  nexport_cli_ts --> nsnapshot_ts
  nindex_ts --> ncatalog_
  nindex_ts -.-> noffer_ts
  nindex_ts --> nsnapshot_ts
  nindex_ts -.-> nterms_ts
  nsnapshot_ts -.-> noffer_ts
```

## Files

- catalog/: src/catalog/growth-partner.ts, src/catalog/operations.ts, src/catalog/recruiting.ts
- export-cli.ts
- index.ts
- offer.ts
- snapshot.ts
- terms.ts
- vitest.config.ts

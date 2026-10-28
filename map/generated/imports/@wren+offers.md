# @wren/offers

Role: package. Files: 9.

## Outside packages

node:fs, node:path

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nindex_ts["index.ts"]
  ncatalog_["catalog/ (3)"]
  noffer_ts["offer.ts"]
  nsnapshot_ts["snapshot.ts"]
  nterms_ts["terms.ts"]
  nexport_cli_ts["export-cli.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> ncatalog_
  nindex_ts --> noffer_ts
  nindex_ts --> nsnapshot_ts
  nindex_ts -.-> nterms_ts
  ncatalog_ --> noffer_ts
  nsnapshot_ts -.-> noffer_ts
  nexport_cli_ts --> nindex_ts
  nexport_cli_ts --> nsnapshot_ts
```

## Files

- catalog/: src/catalog/growth-partner.ts, src/catalog/operations.ts, src/catalog/recruiting.ts
- export-cli.ts
- index.ts
- offer.ts
- snapshot.ts
- terms.ts
- vitest.config.ts

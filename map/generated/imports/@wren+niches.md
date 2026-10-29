# @wren/niches

Role: package. Files: 16.

## Uses

- @wren/channel-email
- @wren/channel-sms
- @wren/core
- @wren/db
- @wren/offers
- @wren/research

## Outside packages

node:crypto, node:fs, node:path, node:zlib

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nagencies_ts["agencies.ts"]
  nagencies_["agencies/ (5)"]
  nindex_ts["index.ts"]
  nniche_ts["niche.ts"]
  nrecruiting_ts["recruiting.ts"]
  nrecruiting_["recruiting/"]
  nsec_ria_ts["sec-ria.ts"]
  nsec_ria_["sec-ria/ (4)"]
  nvitest_config_ts["vitest.config.ts"]
  nagencies_ts --> nagencies_
  nagencies_ts --> nniche_ts
  nindex_ts --> nagencies_ts
  nindex_ts -.-> nniche_ts
  nindex_ts --> nrecruiting_ts
  nindex_ts --> nsec_ria_ts
  nrecruiting_ts --> nniche_ts
  nrecruiting_ts --> nrecruiting_
  nsec_ria_ts --> nniche_ts
  nsec_ria_ts --> nsec_ria_
```

## Files

- agencies.ts
- agencies/: src/agencies/clutch-pages.ts, src/agencies/directory.ts, src/agencies/facts.ts, src/agencies/profiles.ts, src/agencies/shopify-pages.ts
- index.ts
- niche.ts
- recruiting.ts
- recruiting/: src/recruiting/sources.ts
- sec-ria.ts
- sec-ria/: src/sec-ria/datasets.ts, src/sec-ria/filing-data.ts, src/sec-ria/firm-feed.ts, src/sec-ria/roster.ts
- vitest.config.ts

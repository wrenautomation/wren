# @wren/starling-core

Role: package. Files: 10.

## Uses

- @wren/core

## Outside packages

@restatedev/restate-sdk@1.17.1, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncampaigns_ts["campaigns.ts"]
  nindex_ts["index.ts"]
  ninsights_ts["insights.ts"]
  npage_inbox_ts["page-inbox.ts"]
  nproof_ts["proof.ts"]
  nservice_ts["service.ts"]
  nshapes_ts["shapes.ts"]
  nslides_ts["slides.ts"]
  nthread_ts["thread.ts"]
  ntiktok_ts["tiktok.ts"]
  nindex_ts -.-> ninsights_ts
  nindex_ts --> nproof_ts
  nservice_ts -.-> nindex_ts
  nservice_ts --> nshapes_ts
  nshapes_ts -.-> nindex_ts
  nshapes_ts --> nslides_ts
  nshapes_ts --> ntiktok_ts
```

## Files

- campaigns.ts
- index.ts
- insights.ts
- page-inbox.ts
- proof.ts
- service.ts
- shapes.ts
- slides.ts
- thread.ts
- tiktok.ts

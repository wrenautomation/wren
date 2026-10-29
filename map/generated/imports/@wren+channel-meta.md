# @wren/channel-meta

Role: package. Files: 18.

## Uses

- @wren/core
- @wren/db

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nads_ts["ads.ts"]
  naudit_ts["audit.ts"]
  nbridge_ts["bridge.ts"]
  ncomponents_ts["components.ts"]
  nconsent_ts["consent.ts"]
  ncontent_web_ts["content-web.ts"]
  ncontent_ts["content.ts"]
  ndays_ts["days.ts"]
  nindex_ts["index.ts"]
  nlaunches_ts["launches.ts"]
  npoll_ts["poll.ts"]
  nrecords_ts["records.ts"]
  nrestate_ts["restate.ts"]
  nschema_ts["schema.ts"]
  nsetups_ts["setups.ts"]
  nthreads_ts["threads.ts"]
  nwatch_ts["watch.ts"]
  nvitest_config_ts["vitest.config.ts"]
  naudit_ts --> nads_ts
  nbridge_ts -.-> nads_ts
  nbridge_ts -.-> nlaunches_ts
  ncomponents_ts --> naudit_ts
  nconsent_ts -.-> nads_ts
  ncontent_ts --> npoll_ts
  ndays_ts -.-> nads_ts
  ndays_ts --> nschema_ts
  nindex_ts --> nads_ts
  nindex_ts --> naudit_ts
  nindex_ts --> nbridge_ts
  nindex_ts --> ncontent_web_ts
  nindex_ts --> ncontent_ts
  nindex_ts --> ndays_ts
  nindex_ts --> nlaunches_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsetups_ts
  nindex_ts --> nthreads_ts
  nlaunches_ts -.-> nads_ts
  nlaunches_ts --> nschema_ts
  nrecords_ts --> nschema_ts
  nrestate_ts --> nads_ts
  nrestate_ts --> naudit_ts
  nrestate_ts --> nconsent_ts
  nrestate_ts --> nlaunches_ts
  nrestate_ts --> nwatch_ts
  nschema_ts -.-> nads_ts
  nsetups_ts --> nads_ts
  nthreads_ts --> ncontent_ts
  nthreads_ts --> npoll_ts
  nwatch_ts -.-> nads_ts
  nwatch_ts --> nbridge_ts
  nwatch_ts --> ndays_ts
  nwatch_ts --> nlaunches_ts
```

## Files

- ads.ts
- audit.ts
- bridge.ts
- components.ts
- consent.ts
- content-web.ts
- content.ts
- days.ts
- index.ts
- launches.ts
- poll.ts
- records.ts
- restate.ts
- schema.ts
- setups.ts
- threads.ts
- vitest.config.ts
- watch.ts

# @wren/channel-search

Role: package. Files: 23.

## Uses

- @wren/core
- @wren/db
- @wren/llm
- @wren/channel-email
- @wren/sites
- @wren/experiments

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nindex_ts["index.ts"]
  nanswers_ts["answers.ts"]
  nkeywords_ts["keywords.ts"]
  nschema_ts["schema.ts"]
  napply_ts["apply.ts"]
  nbrief_ts["brief.ts"]
  ncitability_ts["citability.ts"]
  nconsole_ts["console.ts"]
  nheat_ts["heat.ts"]
  npropose_ts["propose.ts"]
  nsetups_ts["setups.ts"]
  nsite_days_ts["site-days.ts"]
  nsite_ts["site.ts"]
  nsync_ts["sync.ts"]
  nrestate_["restate/ (2)"]
  nexperiments_ts["experiments.ts"]
  nflag_days_ts["flag-days.ts"]
  nlink_days_ts["link-days.ts"]
  nsurvey_days_ts["survey-days.ts"]
  nrecords_ts["records.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> nanswers_ts
  nindex_ts --> napply_ts
  nindex_ts --> nbrief_ts
  nindex_ts --> ncitability_ts
  nindex_ts --> nconsole_ts
  nindex_ts --> nheat_ts
  nindex_ts --> nkeywords_ts
  nindex_ts --> npropose_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsetups_ts
  nindex_ts --> nsite_days_ts
  nindex_ts --> nsite_ts
  nindex_ts --> nsync_ts
  nanswers_ts --> nkeywords_ts
  nanswers_ts --> nschema_ts
  nkeywords_ts --> nschema_ts
  napply_ts -.-> nschema_ts
  nconsole_ts --> nschema_ts
  nheat_ts --> nschema_ts
  npropose_ts --> nschema_ts
  nsetups_ts --> nconsole_ts
  nsite_days_ts --> nschema_ts
  nsite_ts --> nconsole_ts
  nsync_ts --> nconsole_ts
  nsync_ts --> nschema_ts
  nrestate_ --> nanswers_ts
  nrestate_ --> ncomponents_ts
  nrestate_ --> nconsole_ts
  nrestate_ --> nexperiments_ts
  nrestate_ --> nflag_days_ts
  nrestate_ --> nheat_ts
  nrestate_ --> nkeywords_ts
  nrestate_ --> nlink_days_ts
  nrestate_ --> nschema_ts
  nrestate_ --> nsite_days_ts
  nrestate_ --> nsite_ts
  nrestate_ --> nsurvey_days_ts
  nrestate_ --> nsync_ts
  nflag_days_ts -.-> nsite_days_ts
  nlink_days_ts --> nschema_ts
  nlink_days_ts -.-> nsite_days_ts
  nsurvey_days_ts --> nflag_days_ts
  nrecords_ts --> nflag_days_ts
  nrecords_ts -.-> nschema_ts
```

## Files

- answers.ts
- apply.ts
- brief.ts
- citability.ts
- components.ts
- console.ts
- experiments.ts
- flag-days.ts
- heat.ts
- index.ts
- keywords.ts
- link-days.ts
- propose.ts
- records.ts
- restate/: src/restate/index.ts, src/restate/watch.ts
- schema.ts
- setups.ts
- site-days.ts
- site.ts
- survey-days.ts
- sync.ts
- vitest.config.ts

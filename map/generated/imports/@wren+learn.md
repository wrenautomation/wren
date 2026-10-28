# @wren/learn

Role: package. Files: 29.

## Uses

- @wren/core
- @wren/db
- @wren/research
- @wren/llm
- @wren/notes

## Outside packages

node:fs, node:path

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nindex_ts["index.ts"]
  nalerts_ts["alerts.ts"]
  ndecide_ts["decide.ts"]
  nschema_ts["schema.ts"]
  nscore_ts["score.ts"]
  nbreakdown_ts["breakdown.ts"]
  nfeeds_ts["feeds.ts"]
  ncreators_ts["creators.ts"]
  nlinks_ts["links.ts"]
  nfilm_ts["film.ts"]
  nfindings_ts["findings.ts"]
  ncalls_ts["calls.ts"]
  ncatalog_ts["catalog.ts"]
  nread_ts["read.ts"]
  ncheck_ts["check.ts"]
  nstandard_ts["standard.ts"]
  ndrive_ts["drive.ts"]
  nembed_ts["embed.ts"]
  nhunt_ts["hunt.ts"]
  nitems_ts["items.ts"]
  nlearnback_ts["learnback.ts"]
  npictures_ts["pictures.ts"]
  nsops_ts["sops.ts"]
  ntell_ts["tell.ts"]
  ncomponents_ts["components.ts"]
  nconsole_ts["console.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nrecords_ts["records.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> nalerts_ts
  nindex_ts --> nbreakdown_ts
  nindex_ts --> ncalls_ts
  nindex_ts --> ncatalog_ts
  nindex_ts --> ncheck_ts
  nindex_ts --> ncreators_ts
  nindex_ts --> ndrive_ts
  nindex_ts --> nembed_ts
  nindex_ts --> nfeeds_ts
  nindex_ts --> nfilm_ts
  nindex_ts --> nfindings_ts
  nindex_ts --> nhunt_ts
  nindex_ts --> nitems_ts
  nindex_ts --> nlearnback_ts
  nindex_ts --> nlinks_ts
  nindex_ts --> npictures_ts
  nindex_ts --> nread_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nscore_ts
  nindex_ts --> nsops_ts
  nindex_ts --> nstandard_ts
  nindex_ts --> ntell_ts
  nalerts_ts --> ndecide_ts
  nalerts_ts --> nschema_ts
  ndecide_ts --> nschema_ts
  ndecide_ts --> nscore_ts
  nscore_ts --> nbreakdown_ts
  nscore_ts --> nfeeds_ts
  nscore_ts --> nschema_ts
  nbreakdown_ts --> nfeeds_ts
  nbreakdown_ts --> nfilm_ts
  nbreakdown_ts --> nfindings_ts
  nbreakdown_ts --> nschema_ts
  nbreakdown_ts -.-> nscore_ts
  nfeeds_ts --> ncreators_ts
  nfeeds_ts --> nlinks_ts
  nfeeds_ts --> nschema_ts
  ncreators_ts -.-> nfeeds_ts
  ncreators_ts --> nlinks_ts
  ncreators_ts --> nschema_ts
  nlinks_ts -.-> nschema_ts
  nfilm_ts --> nschema_ts
  nfindings_ts --> ncalls_ts
  nfindings_ts --> nschema_ts
  ncalls_ts --> nschema_ts
  ncatalog_ts --> ncreators_ts
  ncatalog_ts --> nlinks_ts
  ncatalog_ts --> nread_ts
  ncatalog_ts --> nschema_ts
  ncatalog_ts --> nscore_ts
  nread_ts --> nfeeds_ts
  nread_ts --> nlinks_ts
  nread_ts --> nschema_ts
  nread_ts --> nscore_ts
  ncheck_ts --> nstandard_ts
  nstandard_ts --> ncalls_ts
  nstandard_ts --> nschema_ts
  ndrive_ts --> ncalls_ts
  ndrive_ts --> ndecide_ts
  ndrive_ts --> nfilm_ts
  ndrive_ts --> nschema_ts
  ndrive_ts --> nscore_ts
  nembed_ts --> nschema_ts
  nhunt_ts --> ncatalog_ts
  nhunt_ts --> ncreators_ts
  nhunt_ts --> ndrive_ts
  nhunt_ts --> nfeeds_ts
  nhunt_ts --> nitems_ts
  nhunt_ts --> nlinks_ts
  nhunt_ts --> nschema_ts
  nhunt_ts -.-> nstandard_ts
  nitems_ts --> ndecide_ts
  nitems_ts --> nembed_ts
  nitems_ts --> nlinks_ts
  nitems_ts --> nschema_ts
  nlearnback_ts --> nitems_ts
  nlearnback_ts --> nschema_ts
  nlearnback_ts --> nstandard_ts
  npictures_ts -.-> nfeeds_ts
  npictures_ts --> nschema_ts
  nsops_ts --> ndecide_ts
  nsops_ts --> nread_ts
  nsops_ts --> nschema_ts
  ntell_ts --> nschema_ts
  nconsole_ts --> nalerts_ts
  nconsole_ts --> ncalls_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> ndrive_ts
  nconsole_ts --> nembed_ts
  nconsole_ts --> nfeeds_ts
  nconsole_ts --> nitems_ts
  nconsole_ts --> nlinks_ts
  nconsole_ts --> nschema_ts
  nconsole_ts --> nsops_ts
  nrecords_ts --> nitems_ts
  nrecords_ts --> nsops_ts
```

## Files

- alerts.ts
- breakdown.ts
- calls.ts
- catalog.ts
- check.ts
- components.ts
- console-routes.ts
- console.ts
- creators.ts
- decide.ts
- drive.ts
- embed.ts
- feeds.ts
- film.ts
- findings.ts
- hunt.ts
- index.ts
- items.ts
- learnback.ts
- links.ts
- pictures.ts
- read.ts
- records.ts
- schema.ts
- score.ts
- sops.ts
- standard.ts
- tell.ts
- vitest.config.ts

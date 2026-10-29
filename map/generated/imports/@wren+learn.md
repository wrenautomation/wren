# @wren/learn

Role: package. Files: 29.

## Uses

- @wren/core
- @wren/db
- @wren/llm
- @wren/notes
- @wren/research

## Outside packages

@restatedev/restate-sdk@1.17.1, @wrenautomation/falcon@0.8.2, @wrenautomation/weaver@0.8.2, drizzle-orm@0.45.2, node:fs, node:path, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nalerts_ts["alerts.ts"]
  nbreakdown_ts["breakdown.ts"]
  ncalls_ts["calls.ts"]
  ncatalog_ts["catalog.ts"]
  ncheck_ts["check.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ncreators_ts["creators.ts"]
  ndecide_ts["decide.ts"]
  ndrive_ts["drive.ts"]
  nembed_ts["embed.ts"]
  nfeeds_ts["feeds.ts"]
  nfilm_ts["film.ts"]
  nfindings_ts["findings.ts"]
  nhunt_ts["hunt.ts"]
  nindex_ts["index.ts"]
  nitems_ts["items.ts"]
  nlearnback_ts["learnback.ts"]
  nlinks_ts["links.ts"]
  npictures_ts["pictures.ts"]
  nread_ts["read.ts"]
  nrecords_ts["records.ts"]
  nschema_ts["schema.ts"]
  nscore_ts["score.ts"]
  nsops_ts["sops.ts"]
  nstandard_ts["standard.ts"]
  ntell_ts["tell.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nalerts_ts --> ndecide_ts
  nalerts_ts --> nschema_ts
  nbreakdown_ts --> nfeeds_ts
  nbreakdown_ts --> nfilm_ts
  nbreakdown_ts --> nfindings_ts
  nbreakdown_ts --> nschema_ts
  nbreakdown_ts -.-> nscore_ts
  ncalls_ts --> nschema_ts
  ncatalog_ts --> ncreators_ts
  ncatalog_ts --> nlinks_ts
  ncatalog_ts --> nread_ts
  ncatalog_ts --> nschema_ts
  ncatalog_ts --> nscore_ts
  ncheck_ts --> nstandard_ts
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
  ncreators_ts -.-> nfeeds_ts
  ncreators_ts --> nlinks_ts
  ncreators_ts --> nschema_ts
  ndecide_ts --> nschema_ts
  ndecide_ts --> nscore_ts
  ndrive_ts --> ncalls_ts
  ndrive_ts --> ndecide_ts
  ndrive_ts --> nfilm_ts
  ndrive_ts --> nschema_ts
  ndrive_ts --> nscore_ts
  nembed_ts --> nschema_ts
  nfeeds_ts --> ncreators_ts
  nfeeds_ts --> nlinks_ts
  nfeeds_ts --> nschema_ts
  nfilm_ts --> nschema_ts
  nfindings_ts --> ncalls_ts
  nfindings_ts --> nschema_ts
  nhunt_ts --> ncatalog_ts
  nhunt_ts --> ncreators_ts
  nhunt_ts --> ndrive_ts
  nhunt_ts --> nfeeds_ts
  nhunt_ts --> nitems_ts
  nhunt_ts --> nlinks_ts
  nhunt_ts --> nschema_ts
  nhunt_ts -.-> nstandard_ts
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
  nitems_ts --> ndecide_ts
  nitems_ts --> nembed_ts
  nitems_ts --> nlinks_ts
  nitems_ts --> nschema_ts
  nlearnback_ts --> nitems_ts
  nlearnback_ts --> nschema_ts
  nlearnback_ts --> nstandard_ts
  nlinks_ts -.-> nschema_ts
  npictures_ts -.-> nfeeds_ts
  npictures_ts --> nschema_ts
  nread_ts --> nfeeds_ts
  nread_ts --> nlinks_ts
  nread_ts --> nschema_ts
  nread_ts --> nscore_ts
  nrecords_ts --> nitems_ts
  nrecords_ts --> nsops_ts
  nscore_ts --> nbreakdown_ts
  nscore_ts --> nfeeds_ts
  nscore_ts --> nschema_ts
  nsops_ts --> ndecide_ts
  nsops_ts --> nread_ts
  nsops_ts --> nschema_ts
  nstandard_ts --> ncalls_ts
  nstandard_ts --> nschema_ts
  ntell_ts --> nschema_ts
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

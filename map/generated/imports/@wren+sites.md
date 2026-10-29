# @wren/sites

Role: package. Files: 34.

## Uses

- @wren/core
- @wren/db
- @wren/experiments
- @wren/offers

## Outside packages

@restatedev/restate-sdk@1.17.1, drizzle-orm@0.45.2, node:crypto, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nscripts_["scripts/"]
  nchat_widget_ts["chat-widget.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ndetail_ts["detail.ts"]
  ndraft_ts["draft.ts"]
  nform_split_ts["form-split.ts"]
  nform_store_ts["form-store.ts"]
  nforms_ts["forms.ts"]
  nhops_ts["hops.ts"]
  nindex_ts["index.ts"]
  nkit_ts["kit.ts"]
  nlinks_ts["links.ts"]
  nmodel_ts["model.ts"]
  nqr_ts["qr.ts"]
  nrecords_ts["records.ts"]
  nrender_ts["render.ts"]
  nscan_ts["scan.ts"]
  nschema_ts["schema.ts"]
  nservice_ts["service.ts"]
  nshare_ts["share.ts"]
  nsplit_call_ts["split-call.ts"]
  nsplit_ts["split.ts"]
  nstore_ts["store.ts"]
  ntemplates_["templates/ (7)"]
  nviews_ts["views.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nscripts_ --> nconsole_ts
  nscripts_ --> nservice_ts
  ncomponents_ts --> nrecords_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> ndetail_ts
  nconsole_ts --> ndraft_ts
  nconsole_ts --> nform_split_ts
  nconsole_ts --> nform_store_ts
  nconsole_ts --> nkit_ts
  nconsole_ts --> nlinks_ts
  nconsole_ts --> nmodel_ts
  nconsole_ts --> nrecords_ts
  nconsole_ts --> nschema_ts
  nconsole_ts --> nshare_ts
  nconsole_ts --> nsplit_ts
  nconsole_ts --> nstore_ts
  nconsole_ts --> ntemplates_
  ndetail_ts --> nkit_ts
  ndetail_ts --> nmodel_ts
  ndetail_ts -.-> nschema_ts
  ndetail_ts --> nsplit_ts
  ndetail_ts --> nstore_ts
  ndetail_ts --> ntemplates_
  ndraft_ts --> ntemplates_
  nform_split_ts --> nforms_ts
  nform_split_ts -.-> nmodel_ts
  nform_split_ts --> nschema_ts
  nform_split_ts --> nsplit_call_ts
  nform_split_ts --> nsplit_ts
  nform_split_ts --> nstore_ts
  nform_store_ts --> nform_split_ts
  nform_store_ts --> nforms_ts
  nform_store_ts --> nkit_ts
  nform_store_ts --> nmodel_ts
  nform_store_ts --> nschema_ts
  nform_store_ts --> nstore_ts
  nforms_ts --> ntemplates_
  nhops_ts --> nmodel_ts
  nindex_ts --> nconsole_ts
  nindex_ts --> nmodel_ts
  nindex_ts --> nrecords_ts
  nindex_ts --> nservice_ts
  nlinks_ts --> nhops_ts
  nlinks_ts --> nmodel_ts
  nlinks_ts --> nschema_ts
  nlinks_ts --> nstore_ts
  nrecords_ts --> ndetail_ts
  nrecords_ts --> nform_store_ts
  nrecords_ts --> nstore_ts
  nrender_ts --> nforms_ts
  nrender_ts --> nkit_ts
  nrender_ts --> ntemplates_
  nscan_ts --> nstore_ts
  nschema_ts -.-> nforms_ts
  nschema_ts --> nmodel_ts
  nschema_ts -.-> ntemplates_
  nservice_ts --> nform_split_ts
  nservice_ts --> nform_store_ts
  nservice_ts --> nforms_ts
  nservice_ts --> nmodel_ts
  nservice_ts --> nrender_ts
  nservice_ts -.-> nschema_ts
  nservice_ts --> nshare_ts
  nservice_ts --> nsplit_ts
  nservice_ts --> nstore_ts
  nservice_ts --> ntemplates_
  nsplit_ts --> nmodel_ts
  nsplit_ts --> nschema_ts
  nsplit_ts --> nsplit_call_ts
  nsplit_ts --> nstore_ts
  nsplit_ts -.-> ntemplates_
  nstore_ts --> nforms_ts
  nstore_ts --> nmodel_ts
  nstore_ts --> nschema_ts
  nstore_ts --> ntemplates_
  ntemplates_ --> nforms_ts
  nviews_ts --> nmodel_ts
```

## Files

- chat-widget.ts
- components.ts
- console-routes.ts
- console.ts
- detail.ts
- draft.ts
- form-split.ts
- form-store.ts
- forms.ts
- hops.ts
- index.ts
- kit.ts
- links.ts
- model.ts
- qr.ts
- records.ts
- render.ts
- scan.ts
- schema.ts
- scripts/: scripts/seed-preview.ts
- service.ts
- share.ts
- split-call.ts
- split.ts
- store.ts
- templates/: src/templates/index.ts, src/templates/lander.ts, src/templates/listicle.ts, src/templates/page.ts, src/templates/parts.ts, src/templates/sections.ts, src/templates/types.ts
- views.ts
- vitest.config.ts

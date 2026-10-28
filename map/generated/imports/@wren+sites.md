# @wren/sites

Role: package. Files: 34.

## Uses

- @wren/core
- @wren/db
- @wren/offers
- @wren/experiments

## Outside packages

node:crypto

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nrecords_ts["records.ts"]
  ndetail_ts["detail.ts"]
  nkit_ts["kit.ts"]
  nmodel_ts["model.ts"]
  nschema_ts["schema.ts"]
  nforms_ts["forms.ts"]
  ntemplates_["templates/ (7)"]
  nsplit_ts["split.ts"]
  nsplit_call_ts["split-call.ts"]
  nstore_ts["store.ts"]
  nform_store_ts["form-store.ts"]
  nform_split_ts["form-split.ts"]
  nchat_widget_ts["chat-widget.ts"]
  nconsole_ts["console.ts"]
  nconsole_routes_ts["console-routes.ts"]
  ndraft_ts["draft.ts"]
  nlinks_ts["links.ts"]
  nhops_ts["hops.ts"]
  nshare_ts["share.ts"]
  nscan_ts["scan.ts"]
  nrender_ts["render.ts"]
  nservice_ts["service.ts"]
  nqr_ts["qr.ts"]
  nscripts_["scripts/"]
  nindex_ts["index.ts"]
  nviews_ts["views.ts"]
  nvitest_config_ts["vitest.config.ts"]
  ncomponents_ts --> nrecords_ts
  nrecords_ts --> ndetail_ts
  nrecords_ts --> nform_store_ts
  nrecords_ts --> nstore_ts
  ndetail_ts --> nkit_ts
  ndetail_ts --> nmodel_ts
  ndetail_ts -.-> nschema_ts
  ndetail_ts --> nsplit_ts
  ndetail_ts --> nstore_ts
  ndetail_ts --> ntemplates_
  nschema_ts -.-> nforms_ts
  nschema_ts --> nmodel_ts
  nschema_ts -.-> ntemplates_
  nforms_ts --> ntemplates_
  ntemplates_ --> nforms_ts
  nsplit_ts --> nmodel_ts
  nsplit_ts --> nschema_ts
  nsplit_ts --> nsplit_call_ts
  nsplit_ts --> nstore_ts
  nsplit_ts -.-> ntemplates_
  nstore_ts --> nforms_ts
  nstore_ts --> nmodel_ts
  nstore_ts --> nschema_ts
  nstore_ts --> ntemplates_
  nform_store_ts --> nform_split_ts
  nform_store_ts --> nforms_ts
  nform_store_ts --> nkit_ts
  nform_store_ts --> nmodel_ts
  nform_store_ts --> nschema_ts
  nform_store_ts --> nstore_ts
  nform_split_ts --> nforms_ts
  nform_split_ts -.-> nmodel_ts
  nform_split_ts --> nschema_ts
  nform_split_ts --> nsplit_call_ts
  nform_split_ts --> nsplit_ts
  nform_split_ts --> nstore_ts
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
  ndraft_ts --> ntemplates_
  nlinks_ts --> nhops_ts
  nlinks_ts --> nmodel_ts
  nlinks_ts --> nschema_ts
  nlinks_ts --> nstore_ts
  nhops_ts --> nmodel_ts
  nscan_ts --> nstore_ts
  nrender_ts --> nforms_ts
  nrender_ts --> nkit_ts
  nrender_ts --> ntemplates_
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
  nscripts_ --> nconsole_ts
  nscripts_ --> nservice_ts
  nindex_ts --> nconsole_ts
  nindex_ts --> nmodel_ts
  nindex_ts --> nrecords_ts
  nindex_ts --> nservice_ts
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

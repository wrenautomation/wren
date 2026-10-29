# @wren/reactivation

Role: package. Files: 57.

## Uses

- @wren/channel-email
- @wren/connectors
- @wren/core
- @wren/db
- @wren/delivery
- @wren/llm
- @wren/offers
- @wren/research
- @wren/video

## Outside packages

@restatedev/restate-sdk@1.17.1, @wrenautomation/weaver@0.8.2, drizzle-orm@0.45.2, node:crypto, node:fs, node:path, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  napprove_ts["approve.ts"]
  nbrief_ts["brief.ts"]
  ncomponents_ts["components.ts"]
  ncompose_ts["compose.ts"]
  ncrm_run_ts["crm-run.ts"]
  ncrm_["crm/ (8)"]
  ndelivery_ts["delivery.ts"]
  ndemo_["demo/ (2)"]
  nevents_ts["events.ts"]
  nfamily_ts["family.ts"]
  nfeed_ts["feed.ts"]
  nforward_ts["forward.ts"]
  nhandoff_ts["handoff.ts"]
  nindex_ts["index.ts"]
  nkeep_ts["keep.ts"]
  nlookup_ts["lookup.ts"]
  nloop_ts["loop.ts"]
  nmovers_ts["movers.ts"]
  nportal_["portal/ (15)"]
  nprofile_ts["profile.ts"]
  nranked_ts["ranked.ts"]
  nrestate_ts["restate.ts"]
  nrun_ts["run.ts"]
  nschema_ts["schema.ts"]
  nscore_ts["score.ts"]
  nsending_ts["sending.ts"]
  nsettings_ts["settings.ts"]
  nsignals_ts["signals.ts"]
  nstatus_ts["status.ts"]
  nvideo_["video/ (4)"]
  ntest_["test/"]
  nvitest_config_ts["vitest.config.ts"]
  napprove_ts --> ncompose_ts
  nbrief_ts --> nfeed_ts
  nbrief_ts --> nschema_ts
  nbrief_ts --> nscore_ts
  ncomponents_ts --> nsettings_ts
  ncompose_ts --> nbrief_ts
  ncompose_ts --> ncrm_
  ncompose_ts --> nfeed_ts
  ncompose_ts --> nschema_ts
  ncompose_ts --> nscore_ts
  ncompose_ts -.-> nsettings_ts
  ncrm_run_ts --> ncompose_ts
  ncrm_run_ts --> nfamily_ts
  ncrm_run_ts --> nlookup_ts
  ncrm_run_ts --> nprofile_ts
  ncrm_run_ts --> nrun_ts
  ncrm_run_ts --> nsettings_ts
  ncrm_run_ts --> nstatus_ts
  ncrm_ --> nschema_ts
  ncrm_ --> nscore_ts
  ndelivery_ts --> ncompose_ts
  ndelivery_ts --> nhandoff_ts
  ndelivery_ts -.-> nsettings_ts
  ndemo_ --> ncrm_
  nevents_ts --> nfeed_ts
  nfamily_ts --> nscore_ts
  nfeed_ts -.-> nrun_ts
  nfeed_ts -.-> nstatus_ts
  nforward_ts --> ncompose_ts
  nforward_ts --> nhandoff_ts
  nforward_ts -.-> nschema_ts
  nforward_ts -.-> nsettings_ts
  nhandoff_ts --> ncompose_ts
  nhandoff_ts --> nschema_ts
  nindex_ts --> napprove_ts
  nindex_ts --> nbrief_ts
  nindex_ts --> ncompose_ts
  nindex_ts --> ncrm_
  nindex_ts --> ndelivery_ts
  nindex_ts --> ndemo_
  nindex_ts --> nfamily_ts
  nindex_ts --> nforward_ts
  nindex_ts --> nhandoff_ts
  nindex_ts --> nkeep_ts
  nindex_ts --> nlookup_ts
  nindex_ts --> nportal_
  nindex_ts --> nprofile_ts
  nindex_ts --> nranked_ts
  nindex_ts --> nrun_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nscore_ts
  nindex_ts --> nsending_ts
  nindex_ts --> nsettings_ts
  nindex_ts --> nsignals_ts
  nindex_ts --> nstatus_ts
  nkeep_ts --> nschema_ts
  nlookup_ts --> nfamily_ts
  nlookup_ts --> nfeed_ts
  nlookup_ts --> nscore_ts
  nloop_ts --> ndelivery_ts
  nloop_ts --> nforward_ts
  nloop_ts --> nkeep_ts
  nloop_ts --> nprofile_ts
  nloop_ts --> nrun_ts
  nloop_ts --> nsending_ts
  nloop_ts -.-> nsettings_ts
  nloop_ts -.-> nstatus_ts
  nmovers_ts --> nschema_ts
  nmovers_ts --> nscore_ts
  nportal_ --> ncrm_
  nportal_ --> nbrief_ts
  nportal_ --> ncompose_ts
  nportal_ --> nprofile_ts
  nportal_ --> nsettings_ts
  nportal_ --> nstatus_ts
  nportal_ --> nscore_ts
  nportal_ -.-> napprove_ts
  nportal_ --> ndelivery_ts
  nportal_ --> nhandoff_ts
  nportal_ --> nranked_ts
  nportal_ --> nfeed_ts
  nportal_ -.-> nschema_ts
  nprofile_ts --> nschema_ts
  nranked_ts -.-> nscore_ts
  nrestate_ts --> ncrm_run_ts
  nrestate_ts --> nloop_ts
  nrestate_ts --> nportal_
  nrun_ts --> nbrief_ts
  nrun_ts --> ncompose_ts
  nrun_ts --> ncrm_
  nrun_ts --> nevents_ts
  nrun_ts --> nfamily_ts
  nrun_ts --> nfeed_ts
  nrun_ts --> nlookup_ts
  nrun_ts --> nmovers_ts
  nrun_ts -.-> nschema_ts
  nrun_ts --> nscore_ts
  nrun_ts -.-> nsettings_ts
  nrun_ts --> nsignals_ts
  nrun_ts --> nstatus_ts
  nscore_ts --> nschema_ts
  nsending_ts --> nsettings_ts
  nsignals_ts --> nfeed_ts
  nsignals_ts --> nscore_ts
  nstatus_ts --> nbrief_ts
  nstatus_ts --> ncompose_ts
  nstatus_ts --> ncrm_
  nstatus_ts --> nevents_ts
  nstatus_ts --> nlookup_ts
  nstatus_ts --> nmovers_ts
  nstatus_ts -.-> nschema_ts
  nstatus_ts --> nscore_ts
  nstatus_ts -.-> nsettings_ts
  nstatus_ts --> nsignals_ts
  nvideo_ --> nportal_
```

## Files

- approve.ts
- brief.ts
- components.ts
- compose.ts
- crm-run.ts
- crm/: src/crm/dates.ts, src/crm/formats.ts, src/crm/health.ts, src/crm/import.ts, src/crm/job-orders.ts, src/crm/landing.ts, src/crm/source.ts, src/crm/verify.ts
- delivery.ts
- demo/: src/demo/history.ts, src/demo/seed.ts
- events.ts
- family.ts
- feed.ts
- forward.ts
- handoff.ts
- index.ts
- keep.ts
- lookup.ts
- loop.ts
- movers.ts
- portal/: src/portal/import-log.ts, src/portal/import.ts, src/portal/journey.ts, src/portal/mask.ts, src/portal/outbox.ts, src/portal/pipeline.ts, src/portal/record-views.ts, src/portal/records.ts, src/portal/routes.ts, src/portal/run.ts, src/portal/service.ts, src/portal/setup.ts, src/portal/story.ts, src/portal/views.ts, src/portal/work.ts
- profile.ts
- ranked.ts
- restate.ts
- run.ts
- schema.ts
- score.ts
- sending.ts
- settings.ts
- signals.ts
- status.ts
- test/: test/integration/demo-fixture.ts
- video/: src/video/brief.ts, src/video/index.ts, src/video/lead.ts, src/video/walk.ts
- vitest.config.ts

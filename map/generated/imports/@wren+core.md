# @wren/core

Role: package. Files: 255.

## Uses

- @wren/db

## Outside packages

@aws-sdk/client-ec2@3.1136.0, @jitl/quickjs-singlefile-mjs-release-sync@0.32.0, @restatedev/restate-sdk-clients@1.17.1, @restatedev/restate-sdk-testcontainers@1.17.1, @restatedev/restate-sdk@1.17.1, @typesafe-ai/sdk@0.6.0, @wrenautomation/models@0.8.2, csv-parse@7.0.2, drizzle-orm@0.45.2, entities@8.1.0, free-email-domains@1.12.20, node:async_hooks, node:crypto, node:dns, node:fs, node:https, node:net, node:path, node:process, node:tls, node:url, postal-mime@4.0.4, quickjs-emscripten-core@0.32.0, tldts@7.4.16, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  naccess_asks_ts["access-asks.ts"]
  naccess_console_ts["access-console.ts"]
  naccess_records_ts["access-records.ts"]
  naccess_ts["access.ts"]
  naccounts_console_routes_ts["accounts-console-routes.ts"]
  naccounts_console_ts["accounts-console.ts"]
  nask_ts["ask.ts"]
  naudit_ts["audit.ts"]
  nautomations_ts["automations.ts"]
  nbounces_schema_ts["bounces-schema.ts"]
  nbounces_ts["bounces.ts"]
  nbroadcast_records_ts["broadcast-records.ts"]
  nbroadcast_run_ts["broadcast-run.ts"]
  nbroadcasts_schema_ts["broadcasts-schema.ts"]
  nbroadcasts_ts["broadcasts.ts"]
  nbuckets_ts["buckets.ts"]
  ncache_ts["cache.ts"]
  ncalendar_ts["calendar.ts"]
  ncalls_ts["calls.ts"]
  nchannel_stats_schema_ts["channel-stats-schema.ts"]
  nchannel_stats_ts["channel-stats.ts"]
  nchecks_ts["checks.ts"]
  nclients_["clients/ (4)"]
  ncode_step_ts["code-step.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  nconsole_["console/ (18)"]
  ncontent_["content/ (15)"]
  ncustom_console_ts["custom-console.ts"]
  ncustom_fields_ts["custom-fields.ts"]
  ncustom_schema_ts["custom-schema.ts"]
  ndead_letter_schema_ts["dead-letter-schema.ts"]
  ndead_letters_ts["dead-letters.ts"]
  ndecide_schema_ts["decide-schema.ts"]
  ndecide_["decide/ (10)"]
  ndoh_ts["doh.ts"]
  ndoor_ts["door.ts"]
  ndoors_ts["doors.ts"]
  ndraft_models_ts["draft-models.ts"]
  ndraft_record_ts["draft-record.ts"]
  ndry_ts["dry.ts"]
  nedits_ts["edits.ts"]
  nemail_patterns_ts["email-patterns.ts"]
  nemails_ts["emails.ts"]
  nepsilon_ts["epsilon.ts"]
  nexecutor_ts["executor.ts"]
  nexperiment_store_ts["experiment-store.ts"]
  nfacts_list_ts["facts-list.ts"]
  nfacts_ts["facts.ts"]
  nfeed_ts["feed.ts"]
  nfetch_limit_ts["fetch-limit.ts"]
  nflag_store_ts["flag-store.ts"]
  nflags_ts["flags.ts"]
  nfollow_ts["follow.ts"]
  ngithub_ts["github.ts"]
  ngrants_ts["grants.ts"]
  ngrounded_ts["grounded.ts"]
  nhtml_ts["html.ts"]
  nhttp_ts["http.ts"]
  nids_ts["ids.ts"]
  nin_house_ts["in-house.ts"]
  nindex_ts["index.ts"]
  ningest_["ingest/ (9)"]
  ninstalls_ts["installs.ts"]
  nissues_ts["issues.ts"]
  nkey_id_ts["key-id.ts"]
  nkey_refs_ts["key-refs.ts"]
  nkeys_schema_ts["keys-schema.ts"]
  nkeys_ts["keys.ts"]
  nleads_ts["leads.ts"]
  nlibrary_ts["library.ts"]
  nlimits_schema_ts["limits-schema.ts"]
  nlimits_ts["limits.ts"]
  nline_diff_ts["line-diff.ts"]
  nlogic_ts["logic.ts"]
  nloop_watch_ts["loop-watch.ts"]
  nmail_ts["mail.ts"]
  nmailbox_ts["mailbox.ts"]
  nmarketing_console_routes_ts["marketing-console-routes.ts"]
  nmarketing_records_ts["marketing-records.ts"]
  nmarketing_views_ts["marketing-views.ts"]
  nmarketing_ts["marketing.ts"]
  nmaybe_sent_ts["maybe-sent.ts"]
  nmessage_settings_ts["message-settings.ts"]
  nmessage_step_ts["message-step.ts"]
  nmetered_ts["metered.ts"]
  nmodel_labels_ts["model-labels.ts"]
  nmodel_prices_ts["model-prices.ts"]
  nnotify_ts["notify.ts"]
  nobjects_schema_ts["objects-schema.ts"]
  nobjects_["objects/ (3)"]
  nour_posts_ts["our-posts.ts"]
  noutreach_["outreach/"]
  npass_reasons_ts["pass-reasons.ts"]
  npeople_console_routes_ts["people-console-routes.ts"]
  npeople_console_ts["people-console.ts"]
  npeople_map_pass_ts["people-map-pass.ts"]
  npeople_map_schema_ts["people-map-schema.ts"]
  npeople_map_ts["people-map.ts"]
  npeople_["people/ (7)"]
  nportal_ts["portal.ts"]
  nprofile_findings_ts["profile-findings.ts"]
  nprofile_pipeline_ts["profile-pipeline.ts"]
  nprofile_reach_ts["profile-reach.ts"]
  nprofile_records_ts["profile-records.ts"]
  nprofiles_backfill_ts["profiles-backfill.ts"]
  nprofiles_bulk_ts["profiles-bulk.ts"]
  nprofiles_link_ts["profiles-link.ts"]
  nprofiles_schema_ts["profiles-schema.ts"]
  nprofiles_ts["profiles.ts"]
  npromise_ts["promise.ts"]
  nramp_ts["ramp.ts"]
  nreason_labels_ts["reason-labels.ts"]
  nrecord_accounts_ts["record-accounts.ts"]
  nrecords_delta_ts["records-delta.ts"]
  nrecords_serve_ts["records-serve.ts"]
  nrecords_ts["records.ts"]
  nrefusal_ts["refusal.ts"]
  nreject_reasons_ts["reject-reasons.ts"]
  nreply_drafts_ts["reply-drafts.ts"]
  nreply_who_ts["reply-who.ts"]
  nresp_ts["resp.ts"]
  nrestate_["restate/ (6)"]
  nretention_ts["retention.ts"]
  nruns_ts["runs.ts"]
  nsaved_views_ts["saved-views.ts"]
  nschema_ts["schema.ts"]
  nsegment_records_ts["segment-records.ts"]
  nsegment_step_ts["segment-step.ts"]
  nsegments_pass_ts["segments-pass.ts"]
  nsegments_schema_ts["segments-schema.ts"]
  nsegments_text_ts["segments-text.ts"]
  nsegments_ts["segments.ts"]
  nsend_journal_schema_ts["send-journal-schema.ts"]
  nsend_journal_ts["send-journal.ts"]
  nsend_verdict_ts["send-verdict.ts"]
  nsent_records_ts["sent-records.ts"]
  nsent_url_ts["sent-url.ts"]
  nsent_views_ts["sent-views.ts"]
  nsetup_agent_ts["setup-agent.ts"]
  nsetup_alerts_ts["setup-alerts.ts"]
  nsetup_schema_ts["setup-schema.ts"]
  nsetup_watch_ts["setup-watch.ts"]
  nsetup_ts["setup.ts"]
  nsetups_ts["setups.ts"]
  nslots_["slots/ (7)"]
  nstate_ts["state.ts"]
  nstats_ts["stats.ts"]
  nsuppress_ts["suppress.ts"]
  nsurvey_store_ts["survey-store.ts"]
  nsurveys_ts["surveys.ts"]
  ntemplate_defaults_ts["template-defaults.ts"]
  ntemplate_edits_ts["template-edits.ts"]
  ntemplate_install_ts["template-install.ts"]
  ntemplate_labels_ts["template-labels.ts"]
  ntemplate_records_ts["template-records.ts"]
  ntemplates_console_routes_ts["templates-console-routes.ts"]
  ntemplates_console_ts["templates-console.ts"]
  ntemplates_ts["templates.ts"]
  ntesting_ts["testing.ts"]
  ntime_ts["time.ts"]
  ntokens_ts["tokens.ts"]
  ntouch_feed_ts["touch-feed.ts"]
  ntouch_link_ts["touch-link.ts"]
  ntouches_schema_ts["touches-schema.ts"]
  ntouches_ts["touches.ts"]
  ntrain_ts["train.ts"]
  nvault_keys_ts["vault-keys.ts"]
  nvendor_direct_exa_ts["vendor-direct-exa.ts"]
  nvendor_direct_ts["vendor-direct.ts"]
  nvendor_keys_ts["vendor-keys.ts"]
  nvendor_schema_ts["vendor-schema.ts"]
  nvendor_stop_ts["vendor-stop.ts"]
  nvendors_ts["vendors.ts"]
  nview_as_ts["view-as.ts"]
  nviews_ts["views.ts"]
  nwarm_ts["warm.ts"]
  nwebhook_events_ts["webhook-events.ts"]
  nwebhooks_ts["webhooks.ts"]
  nwire_ts["wire.ts"]
  nworkflow_ask_ts["workflow-ask.ts"]
  nworkflow_templates_ts["workflow-templates.ts"]
  nworkflows_ts["workflows.ts"]
  nvitest_config_ts["vitest.config.ts"]
  naccess_asks_ts --> naccess_ts
  naccess_asks_ts --> nclients_
  naccess_asks_ts --> ngrants_ts
  naccess_asks_ts --> nportal_ts
  naccess_console_ts --> naccess_asks_ts
  naccess_console_ts --> naccess_ts
  naccess_console_ts --> nclients_
  naccess_console_ts --> ngrants_ts
  naccess_console_ts --> nissues_ts
  naccess_console_ts --> nportal_ts
  naccess_console_ts --> nrecords_ts
  naccess_records_ts --> naccess_ts
  naccess_records_ts --> nclients_
  naccess_records_ts --> ngrants_ts
  naccess_records_ts --> nrecords_ts
  naccounts_console_routes_ts -.-> naccess_ts
  naccounts_console_ts --> naccess_ts
  naccounts_console_ts --> naccounts_console_routes_ts
  naccounts_console_ts --> nclients_
  naccounts_console_ts --> nexecutor_ts
  naccounts_console_ts --> nkey_refs_ts
  naccounts_console_ts -.-> nkeys_ts
  naccounts_console_ts --> nlimits_ts
  naccounts_console_ts --> nportal_ts
  naccounts_console_ts --> nrestate_
  naccounts_console_ts --> nsetup_alerts_ts
  naccounts_console_ts -.-> nsetup_schema_ts
  naccounts_console_ts --> nsetup_ts
  naccounts_console_ts --> nvendor_schema_ts
  naccounts_console_ts --> nvendors_ts
  nask_ts --> ndraft_record_ts
  nask_ts --> nedits_ts
  nask_ts --> nportal_ts
  nask_ts --> nrecords_ts
  nask_ts --> nruns_ts
  nask_ts --> nschema_ts
  naudit_ts -.-> nnotify_ts
  naudit_ts --> nrestate_
  nautomations_ts -.-> ncomponents_ts
  nautomations_ts -.-> nconsole_ts
  nautomations_ts --> nlogic_ts
  nautomations_ts --> nrecords_ts
  nautomations_ts --> ntemplate_labels_ts
  nautomations_ts --> nworkflows_ts
  nbounces_schema_ts --> nbroadcasts_schema_ts
  nbounces_schema_ts --> nschema_ts
  nbounces_ts --> nbounces_schema_ts
  nbounces_ts --> nsuppress_ts
  nbroadcast_records_ts --> nbroadcasts_ts
  nbroadcast_records_ts --> nrecords_ts
  nbroadcast_run_ts --> nbroadcasts_ts
  nbroadcast_run_ts --> nrestate_
  nbroadcasts_schema_ts --> nprofiles_schema_ts
  nbroadcasts_schema_ts --> nschema_ts
  nbroadcasts_schema_ts --> nsegments_schema_ts
  nbroadcasts_ts --> nbounces_ts
  nbroadcasts_ts --> nbroadcasts_schema_ts
  nbroadcasts_ts --> nmarketing_ts
  nbroadcasts_ts --> nmessage_settings_ts
  nbroadcasts_ts --> nrefusal_ts
  nbroadcasts_ts --> nschema_ts
  nbroadcasts_ts -.-> nsegments_schema_ts
  nbroadcasts_ts --> nsegments_ts
  nbroadcasts_ts --> nslots_
  nbroadcasts_ts --> ntime_ts
  ncache_ts --> nresp_ts
  ncalls_ts -.-> nrecords_ts
  nchannel_stats_ts --> nchannel_stats_schema_ts
  nchannel_stats_ts --> nrefusal_ts
  nchannel_stats_ts --> nsegments_ts
  nclients_ --> nrefusal_ts
  nclients_ --> naccess_ts
  nclients_ --> ncomponents_ts
  nclients_ --> nrecords_ts
  nclients_ --> nsetup_schema_ts
  ncode_step_ts -.-> nexecutor_ts
  ncode_step_ts --> nlogic_ts
  nconsole_routes_ts -.-> naccess_ts
  nconsole_ts --> nconsole_
  nconsole_ts --> ninstalls_ts
  nconsole_ts --> nrecords_serve_ts
  nconsole_ --> naccess_ts
  nconsole_ --> ngrants_ts
  nconsole_ --> nportal_ts
  nconsole_ --> nruns_ts
  nconsole_ --> nclients_
  nconsole_ --> nview_as_ts
  nconsole_ --> ncomponents_ts
  nconsole_ --> ninstalls_ts
  nconsole_ --> nschema_ts
  nconsole_ --> ntemplate_defaults_ts
  nconsole_ --> ntemplate_install_ts
  nconsole_ --> naccess_records_ts
  nconsole_ --> nask_ts
  nconsole_ --> nautomations_ts
  nconsole_ --> ncustom_fields_ts
  nconsole_ --> nexecutor_ts
  nconsole_ --> nexperiment_store_ts
  nconsole_ --> nflag_store_ts
  nconsole_ --> nlibrary_ts
  nconsole_ --> nrecords_serve_ts
  nconsole_ --> nrecords_ts
  nconsole_ --> nsetup_alerts_ts
  nconsole_ --> nsetup_ts
  nconsole_ --> nsurvey_store_ts
  nconsole_ --> nworkflows_ts
  nconsole_ --> nchecks_ts
  nconsole_ --> ntokens_ts
  nconsole_ --> ndecide_
  nconsole_ --> nedits_ts
  nconsole_ --> nrecord_accounts_ts
  nconsole_ --> nsaved_views_ts
  nconsole_ --> ndoor_ts
  nconsole_ --> ndoors_ts
  nconsole_ --> ndry_ts
  nconsole_ --> nlogic_ts
  nconsole_ --> nrefusal_ts
  nconsole_ --> nworkflow_ask_ts
  nconsole_ --> nworkflow_templates_ts
  nconsole_ --> nin_house_ts
  nconsole_ --> ntemplate_labels_ts
  nconsole_ --> naccess_console_ts
  nconsole_ --> ncustom_console_ts
  nconsole_ --> nconsole_routes_ts
  nconsole_ -.-> nrestate_
  nconsole_ --> ncache_ts
  ncontent_ -.-> ndoh_ts
  ncontent_ -.-> nnotify_ts
  ncontent_ --> nrestate_
  ncontent_ --> nlogic_ts
  ncontent_ --> nmetered_ts
  ncontent_ --> nsend_journal_ts
  ncontent_ --> nsend_verdict_ts
  ncontent_ --> ntime_ts
  ncustom_console_ts --> naccess_console_ts
  ncustom_console_ts --> naccess_ts
  ncustom_console_ts --> ncustom_fields_ts
  ncustom_console_ts -.-> ncustom_schema_ts
  ncustom_console_ts --> nportal_ts
  ncustom_console_ts --> nrecords_ts
  ncustom_fields_ts --> ncustom_schema_ts
  ncustom_fields_ts -.-> nexecutor_ts
  ncustom_fields_ts --> nportal_ts
  ncustom_fields_ts --> nrecords_ts
  ncustom_fields_ts --> nwebhook_events_ts
  ncustom_schema_ts --> nclients_
  ndead_letters_ts -.-> nconsole_ts
  ndead_letters_ts --> ndead_letter_schema_ts
  ndead_letters_ts -.-> nnotify_ts
  ndead_letters_ts --> nrestate_
  ndecide_ --> ndecide_schema_ts
  ndecide_ -.-> nschema_ts
  ndecide_ --> nclients_
  ndecide_ --> nrestate_
  ndecide_ --> npeople_map_ts
  ndecide_ --> nprofile_reach_ts
  ndoors_ts --> nlogic_ts
  ndoors_ts --> nportal_ts
  ndoors_ts --> nschema_ts
  ndoors_ts -.-> nworkflows_ts
  ndraft_models_ts --> nclients_
  ndraft_models_ts --> nmodel_labels_ts
  ndraft_record_ts -.-> ncontent_
  ndraft_record_ts --> ndecide_
  ndraft_record_ts -.-> nobjects_schema_ts
  ndraft_record_ts --> nobjects_
  ndraft_record_ts --> nreject_reasons_ts
  ndraft_record_ts --> nschema_ts
  ndry_ts --> ncode_step_ts
  ndry_ts -.-> ncomponents_ts
  ndry_ts --> nexecutor_ts
  ndry_ts --> nlogic_ts
  ndry_ts --> nmessage_step_ts
  ndry_ts --> nsegment_step_ts
  ndry_ts --> nwebhook_events_ts
  ndry_ts -.-> nworkflows_ts
  nedits_ts --> nportal_ts
  nedits_ts -.-> nrecords_ts
  nedits_ts --> nrefusal_ts
  nedits_ts --> nschema_ts
  nemail_patterns_ts --> nemails_ts
  nexecutor_ts --> ncode_step_ts
  nexecutor_ts -.-> ncomponents_ts
  nexecutor_ts --> ndoor_ts
  nexecutor_ts --> ndoors_ts
  nexecutor_ts --> nids_ts
  nexecutor_ts --> nleads_ts
  nexecutor_ts --> nlogic_ts
  nexecutor_ts --> nschema_ts
  nexecutor_ts -.-> ntemplates_ts
  nexecutor_ts --> nwebhook_events_ts
  nexecutor_ts --> nwebhooks_ts
  nexecutor_ts --> nworkflows_ts
  nexperiment_store_ts --> nflag_store_ts
  nexperiment_store_ts --> nflags_ts
  nexperiment_store_ts --> nportal_ts
  nexperiment_store_ts --> nrecords_ts
  nexperiment_store_ts --> nschema_ts
  nfacts_ts --> nclients_
  nfacts_ts --> ncomponents_ts
  nfacts_ts --> nedits_ts
  nfacts_ts --> nfacts_list_ts
  nfacts_ts --> nrecords_ts
  nfeed_ts --> nschema_ts
  nflag_store_ts --> nflags_ts
  nflag_store_ts --> nportal_ts
  nflag_store_ts --> nrecords_ts
  nflag_store_ts --> nschema_ts
  nflag_store_ts -.-> nsurveys_ts
  nflags_ts -.-> naccess_ts
  nfollow_ts --> nclients_
  nfollow_ts --> ncomponents_ts
  nfollow_ts -.-> nexecutor_ts
  nfollow_ts --> nleads_ts
  nfollow_ts -.-> ntemplates_ts
  nfollow_ts --> nworkflows_ts
  ngrants_ts --> naccess_ts
  ngrants_ts --> nclients_
  ngrants_ts --> nportal_ts
  ngrounded_ts --> nfacts_list_ts
  ngrounded_ts --> nruns_ts
  nindex_ts --> ncontent_
  nindex_ts --> ndoh_ts
  nindex_ts --> nemail_patterns_ts
  nindex_ts --> nemails_ts
  nindex_ts --> nfeed_ts
  nindex_ts --> ningest_
  nindex_ts --> nnotify_ts
  nindex_ts --> npeople_
  nindex_ts --> nretention_ts
  nindex_ts --> nruns_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nstate_ts
  nindex_ts --> nsuppress_ts
  nindex_ts --> nviews_ts
  ningest_ --> nemails_ts
  ningest_ --> nprofiles_backfill_ts
  ningest_ --> nschema_ts
  ninstalls_ts -.-> nclients_
  ninstalls_ts --> ncomponents_ts
  ninstalls_ts --> nportal_ts
  ninstalls_ts --> nsetup_schema_ts
  nissues_ts --> naccess_ts
  nissues_ts --> nclients_
  nissues_ts --> nportal_ts
  nkey_refs_ts --> nids_ts
  nkeys_schema_ts --> nclients_
  nkeys_ts --> nclients_
  nkeys_ts --> nkey_id_ts
  nkeys_ts --> nkey_refs_ts
  nkeys_ts --> nkeys_schema_ts
  nkeys_ts --> nrefusal_ts
  nleads_ts --> npeople_map_ts
  nleads_ts -.-> nprofiles_ts
  nlibrary_ts --> naccess_ts
  nlibrary_ts -.-> ncomponents_ts
  nlibrary_ts --> nlogic_ts
  nlibrary_ts --> nportal_ts
  nlibrary_ts --> nrecords_ts
  nlibrary_ts --> nschema_ts
  nlibrary_ts --> nworkflows_ts
  nlimits_schema_ts --> nclients_
  nlimits_ts -.-> nbuckets_ts
  nlimits_ts --> nlimits_schema_ts
  nlogic_ts -.-> ncomponents_ts
  nlogic_ts --> ndoor_ts
  nlogic_ts --> nepsilon_ts
  nlogic_ts -.-> nexecutor_ts
  nlogic_ts --> ntime_ts
  nlogic_ts --> nwebhook_events_ts
  nlogic_ts -.-> nworkflows_ts
  nloop_watch_ts --> nconsole_ts
  nloop_watch_ts --> ndead_letter_schema_ts
  nloop_watch_ts -.-> nnotify_ts
  nloop_watch_ts --> nrestate_
  nmailbox_ts -.-> ncontent_
  nmailbox_ts --> nhtml_ts
  nmailbox_ts --> nmail_ts
  nmarketing_console_routes_ts -.-> naccess_ts
  nmarketing_records_ts --> nrecords_ts
  nmarketing_ts --> nmessage_settings_ts
  nmarketing_ts --> nprofiles_backfill_ts
  nmarketing_ts --> nschema_ts
  nmarketing_ts --> nsuppress_ts
  nmaybe_sent_ts --> ncontent_
  nmaybe_sent_ts --> nsend_verdict_ts
  nmessage_settings_ts --> nbounces_ts
  nmessage_settings_ts --> nprofiles_ts
  nmessage_settings_ts --> nschema_ts
  nmessage_settings_ts --> nsuppress_ts
  nmessage_step_ts --> nbounces_ts
  nmessage_step_ts --> nbroadcasts_ts
  nmessage_step_ts -.-> nexecutor_ts
  nmessage_step_ts --> nlogic_ts
  nmessage_step_ts --> nmarketing_ts
  nmessage_step_ts --> nmessage_settings_ts
  nmessage_step_ts -.-> nnotify_ts
  nmessage_step_ts --> nrefusal_ts
  nmessage_step_ts --> nschema_ts
  nmessage_step_ts --> nwebhook_events_ts
  nmetered_ts --> ncontent_
  nmetered_ts -.-> ndoh_ts
  nmetered_ts -.-> nkeys_ts
  nmetered_ts --> nvendor_direct_ts
  nmetered_ts --> nvendor_keys_ts
  nmetered_ts --> nvendor_stop_ts
  nmetered_ts --> nvendors_ts
  nmodel_labels_ts --> nreason_labels_ts
  nmodel_labels_ts --> ntemplate_labels_ts
  nobjects_ -.-> ncontent_
  nobjects_ --> nobjects_schema_ts
  noutreach_ -.-> ncontent_
  npeople_console_routes_ts -.-> naccess_ts
  npeople_console_ts --> naccess_ts
  npeople_console_ts --> nbounces_ts
  npeople_console_ts --> nbroadcast_records_ts
  npeople_console_ts --> nbroadcast_run_ts
  npeople_console_ts --> nbroadcasts_ts
  npeople_console_ts -.-> nchannel_stats_schema_ts
  npeople_console_ts --> nchannel_stats_ts
  npeople_console_ts -.-> nclients_
  npeople_console_ts --> ndecide_
  npeople_console_ts --> npeople_console_routes_ts
  npeople_console_ts --> nportal_ts
  npeople_console_ts --> nprofile_findings_ts
  npeople_console_ts --> nprofiles_ts
  npeople_console_ts --> nrecords_serve_ts
  npeople_console_ts --> nrecords_ts
  npeople_console_ts --> nrestate_
  npeople_console_ts --> nschema_ts
  npeople_console_ts --> nsegment_records_ts
  npeople_console_ts --> nsegments_text_ts
  npeople_console_ts --> nsegments_ts
  npeople_console_ts --> nsent_records_ts
  npeople_map_pass_ts --> npeople_map_ts
  npeople_map_pass_ts --> nrestate_
  npeople_map_schema_ts --> nprofiles_schema_ts
  npeople_map_ts --> npeople_map_schema_ts
  npeople_map_ts --> nprofiles_ts
  npeople_ --> ningest_
  npeople_ --> nprofiles_backfill_ts
  npeople_ --> nschema_ts
  npeople_ --> nemails_ts
  nportal_ts --> naccess_ts
  nportal_ts --> nclients_
  nportal_ts --> nflags_ts
  nportal_ts --> ngrants_ts
  nportal_ts --> nrefusal_ts
  nportal_ts --> nrestate_
  nportal_ts --> nschema_ts
  nprofile_findings_ts --> nprofiles_schema_ts
  nprofile_findings_ts --> nprofiles_ts
  nprofile_findings_ts --> nrefusal_ts
  nprofile_findings_ts --> ntouches_ts
  nprofile_reach_ts --> ntouches_ts
  nprofile_records_ts --> ndecide_
  nprofile_records_ts --> npeople_map_schema_ts
  nprofile_records_ts --> npeople_map_ts
  nprofile_records_ts --> nprofile_findings_ts
  nprofile_records_ts --> nprofile_reach_ts
  nprofile_records_ts --> nprofiles_schema_ts
  nprofile_records_ts --> nrecords_ts
  nprofile_records_ts --> nsegments_ts
  nprofile_records_ts --> ntouches_ts
  nprofile_records_ts -.-> nworkflows_ts
  nprofiles_backfill_ts --> nprofiles_ts
  nprofiles_backfill_ts --> ntouches_ts
  nprofiles_bulk_ts --> nprofiles_backfill_ts
  nprofiles_bulk_ts --> nprofiles_ts
  nprofiles_link_ts --> nprofiles_schema_ts
  nprofiles_link_ts --> nprofiles_ts
  nprofiles_schema_ts --> ntouches_schema_ts
  nprofiles_ts --> nprofile_pipeline_ts
  nprofiles_ts --> nprofiles_schema_ts
  nprofiles_ts --> ntouches_ts
  nreason_labels_ts --> ntemplate_labels_ts
  nrecords_delta_ts -.-> nrecords_serve_ts
  nrecords_serve_ts --> naccess_ts
  nrecords_serve_ts --> nedits_ts
  nrecords_serve_ts --> nportal_ts
  nrecords_serve_ts --> nrecords_delta_ts
  nrecords_serve_ts --> nrecords_ts
  nrecords_serve_ts --> ntime_ts
  nrecords_serve_ts --> ntrain_ts
  nrecords_ts --> naccess_ts
  nrecords_ts --> nmodel_labels_ts
  nrecords_ts --> nrecord_accounts_ts
  nrecords_ts --> ntemplate_labels_ts
  nreply_drafts_ts --> nclients_
  nreply_who_ts --> nprofiles_ts
  nrestate_ --> nchecks_ts
  nrestate_ -.-> nnotify_ts
  nrestate_ --> nruns_ts
  nruns_ts --> nschema_ts
  nsaved_views_ts --> nportal_ts
  nsaved_views_ts --> nschema_ts
  nschema_ts --> nclients_
  nschema_ts --> ncomponents_ts
  nschema_ts -.-> ndoor_ts
  nschema_ts --> nflags_ts
  nschema_ts -.-> nlogic_ts
  nschema_ts --> nobjects_schema_ts
  nschema_ts --> nreject_reasons_ts
  nschema_ts --> nsurveys_ts
  nschema_ts -.-> nworkflows_ts
  nsegment_records_ts --> nrecords_ts
  nsegment_records_ts -.-> nsegments_schema_ts
  nsegment_records_ts --> nsegments_ts
  nsegment_step_ts -.-> nexecutor_ts
  nsegment_step_ts --> nmessage_step_ts
  nsegment_step_ts --> nprofiles_ts
  nsegment_step_ts --> nsegments_ts
  nsegments_pass_ts --> nbroadcasts_ts
  nsegments_pass_ts --> nexecutor_ts
  nsegments_pass_ts --> nlogic_ts
  nsegments_pass_ts --> nrestate_
  nsegments_pass_ts -.-> nsegments_schema_ts
  nsegments_pass_ts --> nsegments_ts
  nsegments_pass_ts --> ntime_ts
  nsegments_pass_ts -.-> nworkflows_ts
  nsegments_schema_ts --> nprofiles_schema_ts
  nsegments_text_ts --> nchannel_stats_schema_ts
  nsegments_text_ts --> nprofiles_schema_ts
  nsegments_text_ts --> nsegments_ts
  nsegments_ts --> nchannel_stats_schema_ts
  nsegments_ts --> nprofiles_schema_ts
  nsegments_ts --> nrefusal_ts
  nsegments_ts -.-> nsegments_schema_ts
  nsend_journal_schema_ts -.-> nsend_verdict_ts
  nsend_journal_ts --> nsend_journal_schema_ts
  nsend_journal_ts -.-> nsend_verdict_ts
  nsent_records_ts --> nbroadcasts_ts
  nsent_records_ts --> nrecords_ts
  nsetup_agent_ts --> ncontent_
  nsetup_agent_ts --> nexecutor_ts
  nsetup_agent_ts --> nrestate_
  nsetup_agent_ts -.-> nsetup_alerts_ts
  nsetup_agent_ts -.-> nsetup_schema_ts
  nsetup_agent_ts --> nsetup_ts
  nsetup_alerts_ts --> nclients_
  nsetup_alerts_ts -.-> ncomponents_ts
  nsetup_alerts_ts -.-> nnotify_ts
  nsetup_alerts_ts --> nsetup_schema_ts
  nsetup_schema_ts --> nclients_
  nsetup_watch_ts --> nexecutor_ts
  nsetup_watch_ts -.-> nnotify_ts
  nsetup_watch_ts --> nrestate_
  nsetup_watch_ts --> nsetup_alerts_ts
  nsetup_watch_ts --> nsetup_ts
  nsetup_ts --> nclients_
  nsetup_ts --> ncomponents_ts
  nsetup_ts --> ncontent_
  nsetup_ts -.-> ndoh_ts
  nsetup_ts --> nexecutor_ts
  nsetup_ts -.-> nnotify_ts
  nsetup_ts --> nsetup_alerts_ts
  nsetup_ts --> nsetup_schema_ts
  nsetup_ts --> nworkflows_ts
  nsetups_ts --> nsetup_ts
  nstate_ts --> nschema_ts
  nsuppress_ts --> nschema_ts
  nsurvey_store_ts --> nclients_
  nsurvey_store_ts --> nflag_store_ts
  nsurvey_store_ts --> nportal_ts
  nsurvey_store_ts --> nrecords_ts
  nsurvey_store_ts --> nschema_ts
  nsurvey_store_ts --> nsurveys_ts
  ntemplate_defaults_ts --> nslots_
  ntemplate_defaults_ts --> ntemplates_ts
  ntemplate_edits_ts -.-> nrecords_ts
  ntemplate_edits_ts -.-> nschema_ts
  ntemplate_edits_ts --> nslots_
  ntemplate_edits_ts --> ntemplates_ts
  ntemplate_install_ts --> nclients_
  ntemplate_install_ts --> ncomponents_ts
  ntemplate_install_ts --> ndoors_ts
  ntemplate_install_ts --> nexecutor_ts
  ntemplate_install_ts --> ninstalls_ts
  ntemplate_install_ts --> nportal_ts
  ntemplate_install_ts --> nschema_ts
  ntemplate_install_ts --> nsetup_alerts_ts
  ntemplate_install_ts --> nsetup_ts
  ntemplate_install_ts --> ntemplate_defaults_ts
  ntemplate_install_ts --> ntemplate_labels_ts
  ntemplate_install_ts --> ntemplates_ts
  ntemplate_install_ts --> nworkflows_ts
  ntemplate_records_ts --> nrecords_ts
  ntemplate_records_ts --> ntemplate_edits_ts
  ntemplate_records_ts -.-> nworkflows_ts
  ntemplates_console_routes_ts -.-> naccess_ts
  ntemplates_console_ts --> naccess_ts
  ntemplates_console_ts --> nportal_ts
  ntemplates_console_ts --> nrestate_
  ntemplates_console_ts --> nslots_
  ntemplates_console_ts --> ntemplate_edits_ts
  ntemplates_console_ts --> ntemplate_labels_ts
  ntemplates_console_ts --> ntemplates_console_routes_ts
  ntemplates_console_ts --> ntemplates_ts
  ntemplates_ts --> nrefusal_ts
  ntemplates_ts --> nschema_ts
  ntemplates_ts --> nslots_
  ntesting_ts --> nexecutor_ts
  ntokens_ts --> naccess_ts
  ntokens_ts --> nclients_
  ntokens_ts --> nportal_ts
  ntokens_ts --> nrestate_
  ntouch_feed_ts --> nexecutor_ts
  ntouch_feed_ts --> nrestate_
  ntouch_link_ts --> ntouches_schema_ts
  ntouches_schema_ts --> nschema_ts
  ntouches_ts --> nprofiles_backfill_ts
  ntouches_ts --> ntouches_schema_ts
  ntrain_ts -.-> nschema_ts
  nvault_keys_ts --> ncontent_
  nvault_keys_ts --> nkeys_schema_ts
  nvault_keys_ts -.-> nnotify_ts
  nvault_keys_ts --> nrestate_
  nvault_keys_ts --> nvendor_schema_ts
  nvault_keys_ts --> nvendors_ts
  nvendor_direct_exa_ts -.-> ndoh_ts
  nvendor_direct_exa_ts -.-> nvendor_direct_ts
  nvendor_direct_ts -.-> ndoh_ts
  nvendor_direct_ts --> nvendor_direct_exa_ts
  nvendor_keys_ts --> nkey_id_ts
  nvendor_keys_ts -.-> nkeys_ts
  nvendor_keys_ts --> nvendor_schema_ts
  nvendor_keys_ts --> nvendor_stop_ts
  nvendor_keys_ts --> nvendors_ts
  nvendor_schema_ts --> nclients_
  nvendor_stop_ts --> ncontent_
  nvendors_ts --> nbuckets_ts
  nvendors_ts --> nclients_
  nvendors_ts -.-> nkeys_ts
  nvendors_ts --> nmodel_prices_ts
  nvendors_ts --> nvendor_schema_ts
  nview_as_ts --> naccess_ts
  nview_as_ts --> nclients_
  nview_as_ts -.-> ncomponents_ts
  nview_as_ts --> nportal_ts
  nwebhook_events_ts -.-> ncomponents_ts
  nwebhook_events_ts -.-> nlogic_ts
  nwebhooks_ts --> nclients_
  nwebhooks_ts --> ndoors_ts
  nwebhooks_ts -.-> nexecutor_ts
  nwebhooks_ts --> nportal_ts
  nwebhooks_ts --> nrestate_
  nwebhooks_ts --> nschema_ts
  nwebhooks_ts --> nwebhook_events_ts
  nworkflow_ask_ts -.-> ncomponents_ts
  nworkflow_ask_ts --> nlogic_ts
  nworkflow_ask_ts -.-> nworkflows_ts
  nworkflow_templates_ts -.-> ncomponents_ts
  nworkflow_templates_ts --> nportal_ts
  nworkflow_templates_ts --> nschema_ts
  nworkflow_templates_ts --> ntemplate_install_ts
  nworkflow_templates_ts --> nworkflows_ts
  nworkflows_ts --> ncomponents_ts
  nworkflows_ts --> nlogic_ts
  nworkflows_ts -.-> ntemplates_ts
```

## Files

- access-asks.ts
- access-console.ts
- access-records.ts
- access.ts
- accounts-console-routes.ts
- accounts-console.ts
- ask.ts
- audit.ts
- automations.ts
- bounces-schema.ts
- bounces.ts
- broadcast-records.ts
- broadcast-run.ts
- broadcasts-schema.ts
- broadcasts.ts
- buckets.ts
- cache.ts
- calendar.ts
- calls.ts
- channel-stats-schema.ts
- channel-stats.ts
- checks.ts
- clients/: src/clients/domains.ts, src/clients/index.ts, src/clients/schema.ts, src/clients/touch.ts
- code-step.ts
- components.ts
- console-routes.ts
- console.ts
- console/: src/console/api/calls.ts, src/console/api/clients.ts, src/console/api/components.ts, src/console/api/context.ts, src/console/api/executions.ts, src/console/api/library.ts, src/console/api/loops.ts, src/console/api/records.ts, src/console/api/requests.ts, src/console/api/workflows.ts, src/console/components.ts, src/console/console-api.ts, src/console/console-portal.ts, src/console/executions.ts, src/console/handlers.ts, src/console/loops.ts, src/console/restate-admin.ts, src/console/settings.ts
- content/: src/content/autobrowse.ts, src/content/box.ts, src/content/do.ts, src/content/index.ts, src/content/ingress.ts, src/content/insights.ts, src/content/page-inbox.ts, src/content/proof.ts, src/content/renewal.ts, src/content/restate.ts, src/content/routes.ts, src/content/shapes.ts, src/content/slides.ts, src/content/thread.ts, src/content/tiktok.ts
- custom-console.ts
- custom-fields.ts
- custom-schema.ts
- dead-letter-schema.ts
- dead-letters.ts
- decide-schema.ts
- decide/: src/decide/backends.ts, src/decide/calls.ts, src/decide/comments.ts, src/decide/decide.ts, src/decide/export.ts, src/decide/index.ts, src/decide/kinds.ts, src/decide/lead-fit.ts, src/decide/loop.ts, src/decide/stats.ts
- doh.ts
- door.ts
- doors.ts
- draft-models.ts
- draft-record.ts
- dry.ts
- edits.ts
- email-patterns.ts
- emails.ts
- epsilon.ts
- executor.ts
- experiment-store.ts
- facts-list.ts
- facts.ts
- feed.ts
- fetch-limit.ts
- flag-store.ts
- flags.ts
- follow.ts
- github.ts
- grants.ts
- grounded.ts
- html.ts
- http.ts
- ids.ts
- in-house.ts
- index.ts
- ingest/: src/ingest/countries.ts, src/ingest/google-maps.ts, src/ingest/importer.ts, src/ingest/index.ts, src/ingest/overture.ts, src/ingest/sba.ts, src/ingest/schema.ts, src/ingest/screen.ts, src/ingest/sources.ts
- installs.ts
- issues.ts
- key-id.ts
- key-refs.ts
- keys-schema.ts
- keys.ts
- leads.ts
- library.ts
- limits-schema.ts
- limits.ts
- line-diff.ts
- logic.ts
- loop-watch.ts
- mail.ts
- mailbox.ts
- marketing-console-routes.ts
- marketing-records.ts
- marketing-views.ts
- marketing.ts
- maybe-sent.ts
- message-settings.ts
- message-step.ts
- metered.ts
- model-labels.ts
- model-prices.ts
- notify.ts
- objects-schema.ts
- objects/: src/objects/canon.ts, src/objects/index.ts, src/objects/roles.ts
- our-posts.ts
- outreach/: src/outreach/index.ts
- pass-reasons.ts
- people-console-routes.ts
- people-console.ts
- people-map-pass.ts
- people-map-schema.ts
- people-map.ts
- people/: src/people/formats.ts, src/people/importer.ts, src/people/index.ts, src/people/linkedin.ts, src/people/officers.ts, src/people/schema.ts, src/people/sources.ts
- portal.ts
- profile-findings.ts
- profile-pipeline.ts
- profile-reach.ts
- profile-records.ts
- profiles-backfill.ts
- profiles-bulk.ts
- profiles-link.ts
- profiles-schema.ts
- profiles.ts
- promise.ts
- ramp.ts
- reason-labels.ts
- record-accounts.ts
- records-delta.ts
- records-serve.ts
- records.ts
- refusal.ts
- reject-reasons.ts
- reply-drafts.ts
- reply-who.ts
- resp.ts
- restate/: src/restate/form.ts, src/restate/index.ts, src/restate/ingress.ts, src/restate/keys.ts, src/restate/limits.ts, src/restate/loop.ts
- retention.ts
- runs.ts
- saved-views.ts
- schema.ts
- segment-records.ts
- segment-step.ts
- segments-pass.ts
- segments-schema.ts
- segments-text.ts
- segments.ts
- send-journal-schema.ts
- send-journal.ts
- send-verdict.ts
- sent-records.ts
- sent-url.ts
- sent-views.ts
- setup-agent.ts
- setup-alerts.ts
- setup-schema.ts
- setup-watch.ts
- setup.ts
- setups.ts
- slots/: src/slots/index.ts, src/slots/kinds.ts, src/slots/parse.ts, src/slots/pickers.ts, src/slots/preview.ts, src/slots/pyrepr.ts, src/slots/tree.ts
- state.ts
- stats.ts
- suppress.ts
- survey-store.ts
- surveys.ts
- template-defaults.ts
- template-edits.ts
- template-install.ts
- template-labels.ts
- template-records.ts
- templates-console-routes.ts
- templates-console.ts
- templates.ts
- testing.ts
- time.ts
- tokens.ts
- touch-feed.ts
- touch-link.ts
- touches-schema.ts
- touches.ts
- train.ts
- vault-keys.ts
- vendor-direct-exa.ts
- vendor-direct.ts
- vendor-keys.ts
- vendor-schema.ts
- vendor-stop.ts
- vendors.ts
- view-as.ts
- views.ts
- vitest.config.ts
- warm.ts
- webhook-events.ts
- webhooks.ts
- wire.ts
- workflow-ask.ts
- workflow-templates.ts
- workflows.ts

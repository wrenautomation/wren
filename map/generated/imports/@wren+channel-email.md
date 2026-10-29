# @wren/channel-email

Role: package. Files: 132.

## Uses

- @wren/config
- @wren/core
- @wren/db
- @wren/llm
- @wren/research

## Outside packages

node:child_process, node:crypto, node:dns, node:fs, node:util

## Folders

Dotted: types only.

```mermaid
flowchart LR
  naccess_["access/ (7)"]
  ncalls_["calls/ (7)"]
  ncomponents_ts["components.ts"]
  nconcurrent_ts["concurrent.ts"]
  nconsole_routes_ts["console-routes.ts"]
  ndossier_ts["dossier.ts"]
  nfetch_like_ts["fetch-like.ts"]
  nfollow_ts["follow.ts"]
  nguards_ts["guards.ts"]
  ninbox_["inbox/ (16)"]
  nindex_ts["index.ts"]
  nlistmonk_["listmonk/ (5)"]
  noutreach_["outreach/ (15)"]
  nrecontact_ts["recontact.ts"]
  nrecord_views_ts["record-views.ts"]
  nrecords_ts["records.ts"]
  nreport_["report/ (6)"]
  nresolution_["resolution/ (3)"]
  nrestate_["restate/ (20)"]
  nschema_ts["schema.ts"]
  nsend_["send/ (19)"]
  nsequences_settings_ts["sequences-settings.ts"]
  nsequences_ts["sequences.ts"]
  nsetups_ts["setups.ts"]
  nspam_["spam/ (3)"]
  nstate_ts["state.ts"]
  nverification_["verification/ (11)"]
  nviews_ts["views.ts"]
  ntest_["test/ (2)"]
  nvitest_config_ts["vitest.config.ts"]
  naccess_ -.-> nfetch_like_ts
  naccess_ --> nsend_
  ncalls_ --> nschema_ts
  ncalls_ --> ninbox_
  ncomponents_ts --> ncalls_
  ncomponents_ts --> nsequences_settings_ts
  ndossier_ts --> nschema_ts
  nfollow_ts --> ncomponents_ts
  nfollow_ts --> nguards_ts
  nfollow_ts --> noutreach_
  nfollow_ts --> nschema_ts
  ninbox_ --> nsend_
  ninbox_ --> nschema_ts
  ninbox_ -.-> nfetch_like_ts
  ninbox_ --> nviews_ts
  ninbox_ --> nguards_ts
  ninbox_ --> nstate_ts
  ninbox_ --> noutreach_
  nindex_ts --> nconcurrent_ts
  nindex_ts --> ndossier_ts
  nindex_ts --> nfollow_ts
  nindex_ts --> nguards_ts
  nindex_ts --> ninbox_
  nindex_ts --> noutreach_
  nindex_ts --> nrecontact_ts
  nindex_ts --> nreport_
  nindex_ts --> nresolution_
  nindex_ts --> nschema_ts
  nindex_ts --> nsend_
  nindex_ts --> nsequences_settings_ts
  nindex_ts --> nsequences_ts
  nindex_ts --> nsetups_ts
  nindex_ts --> nstate_ts
  nindex_ts --> nverification_
  nindex_ts --> nviews_ts
  nlistmonk_ -.-> nfetch_like_ts
  noutreach_ --> nguards_ts
  noutreach_ --> nrecontact_ts
  noutreach_ --> nschema_ts
  noutreach_ --> nsend_
  noutreach_ --> nstate_ts
  noutreach_ --> nconcurrent_ts
  noutreach_ --> nverification_
  nrecords_ts --> ncalls_
  nrecords_ts --> ninbox_
  nrecords_ts --> nsend_
  nreport_ --> nsend_
  nreport_ --> nschema_ts
  nresolution_ --> nschema_ts
  nresolution_ --> nguards_ts
  nresolution_ --> nstate_ts
  nresolution_ --> nverification_
  nrestate_ --> ninbox_
  nrestate_ --> ncalls_
  nrestate_ -.-> nfetch_like_ts
  nrestate_ -.-> nguards_ts
  nrestate_ --> noutreach_
  nrestate_ --> nrecontact_ts
  nrestate_ --> nsend_
  nrestate_ --> nsequences_ts
  nrestate_ --> nconsole_routes_ts
  nrestate_ --> nrecords_ts
  nrestate_ --> nsequences_settings_ts
  nrestate_ --> nverification_
  nrestate_ --> nlistmonk_
  nrestate_ --> nschema_ts
  nrestate_ --> ncomponents_ts
  nrestate_ --> nreport_
  nrestate_ --> nconcurrent_ts
  nrestate_ --> nresolution_
  nsend_ --> nschema_ts
  nsend_ --> nguards_ts
  nsend_ --> noutreach_
  nsend_ --> nstate_ts
  nsend_ --> nviews_ts
  nsend_ --> nfollow_ts
  nsend_ --> ninbox_
  nsequences_ts -.-> nguards_ts
  nsequences_ts -.-> nrestate_
  nsequences_ts --> nsend_
  nsequences_ts --> nsequences_settings_ts
  nsetups_ts --> ninbox_
  nstate_ts -.-> nschema_ts
  nverification_ --> nschema_ts
  nverification_ --> nsend_
  nverification_ --> nconcurrent_ts
  nverification_ --> nrecontact_ts
  nverification_ --> nresolution_
  nverification_ --> nviews_ts
  ntest_ --> noutreach_
  ntest_ --> nschema_ts
```

## Files

- access/: src/access/access.ts, src/access/console-routes.ts, src/access/console.ts, src/access/mailbox.ts, src/access/oauth.ts, src/access/schema.ts, src/access/setups.ts
- calls/: src/calls/brief.ts, src/calls/index.ts, src/calls/outcome.ts, src/calls/recording.ts, src/calls/restate.ts, src/calls/settings.ts, src/calls/site.ts
- components.ts
- concurrent.ts
- console-routes.ts
- dossier.ts
- fetch-like.ts
- follow.ts
- guards.ts
- inbox/: src/inbox/away.ts, src/inbox/bookings.ts, src/inbox/click-sync.ts, src/inbox/clicks.ts, src/inbox/disposition.ts, src/inbox/health.ts, src/inbox/inbound.ts, src/inbox/index.ts, src/inbox/instantly.ts, src/inbox/invite.ts, src/inbox/marketing-bounces.ts, src/inbox/opens.ts, src/inbox/placement.ts, src/inbox/postmaster.ts, src/inbox/reply.ts, src/inbox/sync.ts
- index.ts
- listmonk/: src/listmonk/campaign.ts, src/listmonk/client.ts, src/listmonk/index.ts, src/listmonk/setup.ts, src/listmonk/sync.ts
- outreach/: src/outreach/authoring.ts, src/outreach/compose.ts, src/outreach/facts.ts, src/outreach/fills.ts, src/outreach/index.ts, src/outreach/live.ts, src/outreach/pages.ts, src/outreach/plan.ts, src/outreach/preview.ts, src/outreach/provenance.ts, src/outreach/readable.ts, src/outreach/refresh.ts, src/outreach/review.ts, src/outreach/sequences.ts, src/outreach/templates.ts
- recontact.ts
- record-views.ts
- records.ts
- report/: src/report/index.ts, src/report/schedule.ts, src/report/send.ts, src/report/stats.ts, src/report/variants.ts, src/report/weekly.ts
- resolution/: src/resolution/index.ts, src/resolution/listed.ts, src/resolution/service.ts
- restate/: src/restate/bounce-scheduler.ts, src/restate/call-bookings.ts, src/restate/clicks-scheduler.ts, src/restate/compose-scheduler.ts, src/restate/console.ts, src/restate/digest-scheduler.ts, src/restate/disposition.ts, src/restate/inbox-scheduler.ts, src/restate/index.ts, src/restate/listmonk.ts, src/restate/marketing.ts, src/restate/newsletter.ts, src/restate/opens-scheduler.ts, src/restate/placement-scheduler.ts, src/restate/pool-scheduler.ts, src/restate/postmaster-scheduler.ts, src/restate/queue-refresh.ts, src/restate/report-scheduler.ts, src/restate/resolution.ts, src/restate/send-scheduler.ts
- schema.ts
- send/: src/send/call-times.ts, src/send/campaign-controls.ts, src/send/dates.ts, src/send/deliver.ts, src/send/gmail.ts, src/send/holidays.ts, src/send/index.ts, src/send/lead-timezone.ts, src/send/mailboxes.ts, src/send/mime.ts, src/send/policy.ts, src/send/reconcile.ts, src/send/rng.ts, src/send/roster.ts, src/send/smtp.ts, src/send/suppress.ts, src/send/tick.ts, src/send/transport.ts, src/send/tz.ts
- sequences-settings.ts
- sequences.ts
- setups.ts
- spam/: src/spam/coverage.ts, src/spam/index.ts, src/spam/spamassassin.ts
- state.ts
- test/: test/integration/compose-fixtures.ts, test/integration/inbox-fixtures.ts
- verification/: src/verification/checks.ts, src/verification/domain-health.ts, src/verification/index.ts, src/verification/lead-checks.ts, src/verification/local.ts, src/verification/mailifier.ts, src/verification/prober-health.ts, src/verification/retry.ts, src/verification/service.ts, src/verification/shared.ts, src/verification/verifier.ts
- views.ts
- vitest.config.ts

# @wren/worker

Role: package. Files: 40.

## Uses

- @wren/books
- @wren/calendar
- @wren/channel-email
- @wren/channel-linkedin
- @wren/channel-meta
- @wren/channel-reddit
- @wren/channel-search
- @wren/channel-sms
- @wren/channel-tiktok
- @wren/channel-x
- @wren/channel-youtube
- @wren/config
- @wren/connectors
- @wren/content
- @wren/core
- @wren/db
- @wren/delivery
- @wren/documents
- @wren/learn
- @wren/llm
- @wren/niches
- @wren/notes
- @wren/offers
- @wren/outreach
- @wren/payments
- @wren/pipeline
- @wren/reactivation
- @wren/research
- @wren/sites
- @wren/voice
- @wren/watch

## Outside packages

node:child_process, node:fs, node:http2, node:path, node:url

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nscripts_["scripts/ (2)"]
  nbox_slot_ts["box-slot.ts"]
  nbox_ts["box.ts"]
  ncomponents_ts["components.ts"]
  nconsole_records_ts["console-records.ts"]
  ngallery_ts["gallery.ts"]
  njourney_research_ts["journey-research.ts"]
  nlambda_ts["lambda.ts"]
  nline_feed_ts["line-feed.ts"]
  nmain_ts["main.ts"]
  nmarketing_ts["marketing.ts"]
  npain_feed_ts["pain-feed.ts"]
  nplanned_ts["planned.ts"]
  nrecord_edits_ts["record-edits.ts"]
  nrecord_types_ts["record-types.ts"]
  nreview_ts["review.ts"]
  nservices_ts["services.ts"]
  nservices_["services/ (18)"]
  nsetups_ts["setups.ts"]
  nsourced_feed_ts["sourced-feed.ts"]
  nwake_ts["wake.ts"]
  nworkflows_ts["workflows.ts"]
  nscripts_ --> ncomponents_ts
  nscripts_ --> ngallery_ts
  nscripts_ --> nworkflows_ts
  nbox_ts --> nbox_slot_ts
  nbox_ts --> nservices_ts
  nbox_ts --> nwake_ts
  ncomponents_ts --> nplanned_ts
  nconsole_records_ts --> nmarketing_ts
  nconsole_records_ts --> nrecord_edits_ts
  nconsole_records_ts --> nreview_ts
  nconsole_records_ts --> nworkflows_ts
  nlambda_ts --> nservices_ts
  nmain_ts --> nservices_ts
  nrecord_types_ts --> ncomponents_ts
  nrecord_types_ts --> nconsole_records_ts
  nrecord_types_ts --> nmarketing_ts
  nrecord_types_ts --> nworkflows_ts
  nservices_ts --> nservices_
  nservices_ --> nsetups_ts
  nservices_ --> nworkflows_ts
  nservices_ --> nmarketing_ts
  nservices_ --> ncomponents_ts
  nservices_ --> njourney_research_ts
  nservices_ --> nline_feed_ts
  nservices_ --> npain_feed_ts
  nservices_ --> nsourced_feed_ts
  nservices_ --> nconsole_records_ts
  nworkflows_ts --> nsetups_ts
```

## Files

- box-slot.ts
- box.ts
- components.ts
- console-records.ts
- gallery.ts
- journey-research.ts
- lambda.ts
- line-feed.ts
- main.ts
- marketing.ts
- pain-feed.ts
- planned.ts
- record-edits.ts
- record-types.ts
- review.ts
- scripts/: scripts/build-lambda.mjs, scripts/gallery-export.ts
- services.ts
- services/: src/services/accounts.ts, src/services/apps.ts, src/services/books.ts, src/services/calendar.ts, src/services/clients.ts, src/services/content-channels.ts, src/services/content.ts, src/services/deps.ts, src/services/email.ts, src/services/executor.ts, src/services/people.ts, src/services/platform.ts, src/services/reach.ts, src/services/reactivation.ts, src/services/research.ts, src/services/search.ts, src/services/sms.ts, src/services/watch.ts
- setups.ts
- sourced-feed.ts
- wake.ts
- workflows.ts

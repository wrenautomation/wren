# @wren/books

Role: package. Files: 28.

## Uses

- @wren/core
- @wren/db
- @wren/llm

## Outside packages

@aws-sdk/client-cloudtrail@3.1136.0, @aws-sdk/client-cost-explorer@3.1136.0, @aws-sdk/client-s3@3.1136.0, @restatedev/restate-sdk@1.17.1, @wrenautomation/falcon@0.8.2, drizzle-orm@0.45.2, node:crypto, node:fs, node:path, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nalerts_ts["alerts.ts"]
  nbills_ts["bills.ts"]
  ncapture_ts["capture.ts"]
  ncard_ts["card.ts"]
  nchart_ts["chart.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ndaily_ts["daily.ts"]
  nday_ts["day.ts"]
  ndecrypts_ts["decrypts.ts"]
  neconomics_ts["economics.ts"]
  nground_ts["ground.ts"]
  nindex_ts["index.ts"]
  nmailbox_ts["mailbox.ts"]
  nmoney_ts["money.ts"]
  npost_ts["post.ts"]
  nrates_ts["rates.ts"]
  nread_ts["read.ts"]
  nrecords_ts["records.ts"]
  nreport_ts["report.ts"]
  nrestate_ts["restate.ts"]
  nschema_ts["schema.ts"]
  nstore_ts["store.ts"]
  ntext_ts["text.ts"]
  nusage_lines_ts["usage-lines.ts"]
  nusage_ts["usage.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nalerts_ts --> nday_ts
  nalerts_ts --> nmoney_ts
  nalerts_ts --> nreport_ts
  nalerts_ts --> nschema_ts
  nbills_ts --> nchart_ts
  nbills_ts --> nmailbox_ts
  ncapture_ts --> nchart_ts
  ncapture_ts --> nday_ts
  ncapture_ts --> nmailbox_ts
  ncapture_ts --> nschema_ts
  ncapture_ts --> nstore_ts
  ncapture_ts --> ntext_ts
  ncard_ts --> nchart_ts
  ncard_ts --> nday_ts
  ncard_ts --> nschema_ts
  ncard_ts --> nstore_ts
  nchart_ts --> nschema_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nschema_ts
  ndaily_ts --> nalerts_ts
  ndaily_ts --> ncapture_ts
  ndaily_ts --> ncard_ts
  ndaily_ts --> nchart_ts
  ndaily_ts --> nday_ts
  ndaily_ts --> ndecrypts_ts
  ndaily_ts -.-> nmailbox_ts
  ndaily_ts --> npost_ts
  ndaily_ts -.-> nrates_ts
  ndaily_ts --> nread_ts
  ndaily_ts -.-> nschema_ts
  ndaily_ts -.-> nstore_ts
  ndaily_ts --> nusage_lines_ts
  ndaily_ts --> nusage_ts
  neconomics_ts --> nschema_ts
  nground_ts --> nmoney_ts
  nground_ts -.-> nschema_ts
  nindex_ts --> nalerts_ts
  nindex_ts --> nbills_ts
  nindex_ts --> ncapture_ts
  nindex_ts --> ncard_ts
  nindex_ts --> nchart_ts
  nindex_ts --> ndaily_ts
  nindex_ts --> nday_ts
  nindex_ts --> ndecrypts_ts
  nindex_ts --> neconomics_ts
  nindex_ts --> nground_ts
  nindex_ts --> nmailbox_ts
  nindex_ts --> nmoney_ts
  nindex_ts --> npost_ts
  nindex_ts --> nrates_ts
  nindex_ts --> nread_ts
  nindex_ts --> nreport_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nstore_ts
  nindex_ts --> ntext_ts
  nindex_ts --> nusage_lines_ts
  nindex_ts --> nusage_ts
  nmailbox_ts -.-> nchart_ts
  npost_ts --> nchart_ts
  npost_ts --> nmoney_ts
  npost_ts --> nrates_ts
  npost_ts --> nschema_ts
  nrates_ts --> nday_ts
  nrates_ts --> nschema_ts
  nread_ts --> nchart_ts
  nread_ts --> nground_ts
  nread_ts --> nmoney_ts
  nread_ts --> nschema_ts
  nrecords_ts --> neconomics_ts
  nreport_ts --> nday_ts
  nreport_ts --> nschema_ts
  nrestate_ts --> nconsole_ts
  nrestate_ts --> ndaily_ts
  nusage_lines_ts --> nschema_ts
  nusage_ts --> nday_ts
  nusage_ts --> nschema_ts
```

## Files

- alerts.ts
- bills.ts
- capture.ts
- card.ts
- chart.ts
- components.ts
- console-routes.ts
- console.ts
- daily.ts
- day.ts
- decrypts.ts
- economics.ts
- ground.ts
- index.ts
- mailbox.ts
- money.ts
- post.ts
- rates.ts
- read.ts
- records.ts
- report.ts
- restate.ts
- schema.ts
- store.ts
- text.ts
- usage-lines.ts
- usage.ts
- vitest.config.ts

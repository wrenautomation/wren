# @wren/calendar

Role: package. Files: 18.

## Uses

- @wren/channel-email
- @wren/channel-sms (types only)
- @wren/core
- @wren/db

## Outside packages

@restatedev/restate-sdk@1.17.1, @wrenautomation/autobrowse@0.5.0, drizzle-orm@0.45.2, node:crypto, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nbook_ts["book.ts"]
  ncomponents_ts["components.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ncontact_ts["contact.ts"]
  ngoogle_ts["google.ts"]
  nindex_ts["index.ts"]
  nlinks_ts["links.ts"]
  nmail_ts["mail.ts"]
  nrecorder_ts["recorder.ts"]
  nrecords_ts["records.ts"]
  nrestate_ts["restate.ts"]
  nrules_ts["rules.ts"]
  nschema_ts["schema.ts"]
  nsetups_ts["setups.ts"]
  nslots_ts["slots.ts"]
  nsms_ts["sms.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nbook_ts -.-> nrules_ts
  nbook_ts --> nschema_ts
  nbook_ts --> nslots_ts
  ncomponents_ts --> nrules_ts
  nconsole_ts --> nbook_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> nrecorder_ts
  nconsole_ts --> nrecords_ts
  nconsole_ts --> nrestate_ts
  nconsole_ts --> nrules_ts
  nconsole_ts --> nslots_ts
  ngoogle_ts -.-> nslots_ts
  nindex_ts --> nbook_ts
  nindex_ts --> ngoogle_ts
  nindex_ts --> nlinks_ts
  nindex_ts --> nmail_ts
  nindex_ts --> nrules_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nsetups_ts
  nindex_ts --> nslots_ts
  nindex_ts --> nsms_ts
  nmail_ts -.-> nschema_ts
  nrecords_ts --> nbook_ts
  nrestate_ts --> nbook_ts
  nrestate_ts --> ncontact_ts
  nrestate_ts --> ngoogle_ts
  nrestate_ts --> nlinks_ts
  nrestate_ts --> nmail_ts
  nrestate_ts --> nrules_ts
  nrestate_ts --> nschema_ts
  nrestate_ts --> nslots_ts
  nrules_ts --> ncontact_ts
  nsetups_ts -.-> ngoogle_ts
  nslots_ts -.-> nrules_ts
  nsms_ts --> nschema_ts
```

## Files

- book.ts
- components.ts
- console-routes.ts
- console.ts
- contact.ts
- google.ts
- index.ts
- links.ts
- mail.ts
- recorder.ts
- records.ts
- restate.ts
- rules.ts
- schema.ts
- setups.ts
- slots.ts
- sms.ts
- vitest.config.ts

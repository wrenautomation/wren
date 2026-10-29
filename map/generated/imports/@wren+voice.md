# @wren/voice

Role: package. Files: 33.

## Uses

- @wren/calendar
- @wren/channel-sms
- @wren/config
- @wren/core
- @wren/db

## Outside packages

@restatedev/restate-sdk@1.17.1, @wrenautomation/models@0.8.2, drizzle-orm@0.45.2, node:crypto, node:http, node:stream, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nagent_ts["agent.ts"]
  nbox_["box/ (3)"]
  nbrain_ts["brain.ts"]
  ncall_now_ts["call-now.ts"]
  ncall_ts["call.ts"]
  ncomponents_ts["components.ts"]
  nconsent_ts["consent.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nconsole_ts["console.ts"]
  ndictation_store_ts["dictation-store.ts"]
  ndictation_["dictation/ (6)"]
  nfakes_ts["fakes.ts"]
  nindex_ts["index.ts"]
  nnode_ts["node.ts"]
  nports_ts["ports.ts"]
  nreading_ts["reading.ts"]
  nrecords_ts["records.ts"]
  nschema_ts["schema.ts"]
  nsentences_ts["sentences.ts"]
  nstore_ts["store.ts"]
  ntools_ts["tools.ts"]
  ntransports_["transports/ (3)"]
  ntypes_ts["types.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nbox_ --> nagent_ts
  nbox_ --> nports_ts
  nbox_ --> nstore_ts
  nbox_ --> ntransports_
  nbox_ --> ncall_ts
  nbox_ -.-> ntools_ts
  nbox_ -.-> ntypes_ts
  nbrain_ts -.-> ntypes_ts
  ncall_now_ts -.-> nagent_ts
  ncall_now_ts --> ncomponents_ts
  ncall_now_ts --> nconsent_ts
  ncall_now_ts -.-> ntransports_
  ncall_ts --> nagent_ts
  ncall_ts --> nsentences_ts
  ncall_ts --> ntools_ts
  ncall_ts -.-> ntypes_ts
  ncomponents_ts --> nagent_ts
  nconsent_ts -.-> nagent_ts
  nconsent_ts --> nschema_ts
  nconsent_ts -.-> ntransports_
  nconsole_ts --> ncall_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts -.-> ndictation_store_ts
  nconsole_ts --> nstore_ts
  nconsole_ts --> ntypes_ts
  ndictation_store_ts --> ndictation_
  ndictation_ -.-> ntypes_ts
  nfakes_ts --> ntools_ts
  nfakes_ts -.-> ntypes_ts
  nindex_ts --> nagent_ts
  nindex_ts --> nbrain_ts
  nindex_ts --> ncall_ts
  nindex_ts --> nfakes_ts
  nindex_ts --> nsentences_ts
  nindex_ts --> ntools_ts
  nindex_ts --> ntransports_
  nindex_ts --> ntypes_ts
  nnode_ts --> ncall_now_ts
  nnode_ts --> nconsent_ts
  nnode_ts --> nports_ts
  nnode_ts --> nstore_ts
  nnode_ts --> ntransports_
  nports_ts --> ntools_ts
  nports_ts -.-> ntypes_ts
  nreading_ts --> nsentences_ts
  nreading_ts -.-> ntypes_ts
  nrecords_ts --> ncall_ts
  nrecords_ts --> nschema_ts
  nschema_ts --> ntypes_ts
  nstore_ts -.-> ncall_ts
  nstore_ts --> nschema_ts
  ntools_ts --> nagent_ts
  ntools_ts -.-> ntypes_ts
  ntransports_ -.-> ntypes_ts
```

## Files

- agent.ts
- box/: src/box/main.ts, src/box/server.ts, src/box/ws.ts
- brain.ts
- call-now.ts
- call.ts
- components.ts
- consent.ts
- console-routes.ts
- console.ts
- dictation-store.ts
- dictation/: src/dictation/commands.ts, src/dictation/ears.ts, src/dictation/index.ts, src/dictation/route.ts, src/dictation/session.ts, src/dictation/transcriber.ts
- fakes.ts
- index.ts
- node.ts
- ports.ts
- reading.ts
- records.ts
- schema.ts
- sentences.ts
- store.ts
- tools.ts
- transports/: src/transports/browser.ts, src/transports/telnyx.ts, src/transports/text.ts
- types.ts
- vitest.config.ts

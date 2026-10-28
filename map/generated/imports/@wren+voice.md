# @wren/voice

Role: package. Files: 33.

## Uses

- @wren/core
- @wren/db
- @wren/channel-sms
- @wren/calendar
- @wren/config

## Outside packages

node:crypto, node:http, node:stream

## Folders

Dotted: types only.

```mermaid
flowchart LR
  ncomponents_ts["components.ts"]
  nagent_ts["agent.ts"]
  nconsole_routes_ts["console-routes.ts"]
  nrecords_ts["records.ts"]
  ncall_ts["call.ts"]
  nsentences_ts["sentences.ts"]
  ntools_ts["tools.ts"]
  ntypes_ts["types.ts"]
  nschema_ts["schema.ts"]
  ndictation_["dictation/ (6)"]
  nconsole_ts["console.ts"]
  ndictation_store_ts["dictation-store.ts"]
  nstore_ts["store.ts"]
  nindex_ts["index.ts"]
  nbrain_ts["brain.ts"]
  nfakes_ts["fakes.ts"]
  ntransports_["transports/ (3)"]
  nreading_ts["reading.ts"]
  nnode_ts["node.ts"]
  ncall_now_ts["call-now.ts"]
  nconsent_ts["consent.ts"]
  nports_ts["ports.ts"]
  nbox_["box/ (3)"]
  nvitest_config_ts["vitest.config.ts"]
  ncomponents_ts --> nagent_ts
  nrecords_ts --> ncall_ts
  nrecords_ts --> nschema_ts
  ncall_ts --> nagent_ts
  ncall_ts --> nsentences_ts
  ncall_ts --> ntools_ts
  ncall_ts --> ntypes_ts
  ntools_ts --> nagent_ts
  ntools_ts -.-> ntypes_ts
  nschema_ts --> ntypes_ts
  ndictation_ -.-> ntypes_ts
  nconsole_ts --> ncall_ts
  nconsole_ts --> nconsole_routes_ts
  nconsole_ts --> ndictation_store_ts
  nconsole_ts --> nstore_ts
  nconsole_ts --> ntypes_ts
  ndictation_store_ts --> ndictation_
  nstore_ts -.-> ncall_ts
  nstore_ts --> nschema_ts
  nindex_ts --> nagent_ts
  nindex_ts --> nbrain_ts
  nindex_ts --> ncall_ts
  nindex_ts --> nfakes_ts
  nindex_ts --> nsentences_ts
  nindex_ts --> ntools_ts
  nindex_ts --> ntransports_
  nindex_ts --> ntypes_ts
  nbrain_ts -.-> ntypes_ts
  nfakes_ts --> ntools_ts
  nfakes_ts -.-> ntypes_ts
  ntransports_ -.-> ntypes_ts
  nreading_ts --> nsentences_ts
  nreading_ts -.-> ntypes_ts
  nnode_ts --> ncall_now_ts
  nnode_ts --> nconsent_ts
  nnode_ts --> nports_ts
  nnode_ts --> nstore_ts
  nnode_ts --> ntransports_
  ncall_now_ts -.-> nagent_ts
  ncall_now_ts --> ncomponents_ts
  ncall_now_ts --> nconsent_ts
  ncall_now_ts -.-> ntransports_
  nconsent_ts -.-> nagent_ts
  nconsent_ts --> nschema_ts
  nconsent_ts --> ntransports_
  nports_ts --> ntools_ts
  nports_ts -.-> ntypes_ts
  nbox_ --> nagent_ts
  nbox_ --> nports_ts
  nbox_ --> nstore_ts
  nbox_ --> ntransports_
  nbox_ --> ncall_ts
  nbox_ -.-> ntools_ts
  nbox_ -.-> ntypes_ts
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

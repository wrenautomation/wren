# @wren/llm

Role: package. Files: 11.

## Outside packages

@wrenautomation/models@0.8.2, node:fs, node:path, vitest@5.0.1, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  naudit_ts["audit.ts"]
  nclient_ts["client.ts"]
  nembed_ts["embed.ts"]
  nenv_ts["env.ts"]
  ngateway_ts["gateway.ts"]
  nindex_ts["index.ts"]
  nparsing_ts["parsing.ts"]
  nstage_ts["stage.ts"]
  ntracing_ts["tracing.ts"]
  nusage_ts["usage.ts"]
  nvitest_config_ts["vitest.config.ts"]
  naudit_ts -.-> nclient_ts
  nembed_ts -.-> nclient_ts
  nindex_ts --> naudit_ts
  nindex_ts --> nclient_ts
  nindex_ts --> nembed_ts
  nindex_ts --> nenv_ts
  nindex_ts --> ngateway_ts
  nindex_ts --> nparsing_ts
  nindex_ts --> nstage_ts
  nindex_ts --> ntracing_ts
  nindex_ts --> nusage_ts
  nstage_ts --> naudit_ts
  nstage_ts --> nclient_ts
  nstage_ts --> nparsing_ts
  nstage_ts --> ntracing_ts
  ntracing_ts -.-> nclient_ts
  ntracing_ts -.-> nstage_ts
  nusage_ts --> naudit_ts
  nusage_ts -.-> nclient_ts
```

## Files

- audit.ts
- client.ts
- embed.ts
- env.ts
- gateway.ts
- index.ts
- parsing.ts
- stage.ts
- tracing.ts
- usage.ts
- vitest.config.ts

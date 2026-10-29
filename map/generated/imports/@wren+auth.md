# @wren/auth

Role: package. Files: 5.

## Uses

- @wren/db

## Outside packages

@better-auth/passkey@1.7.7, better-auth@1.7.7, drizzle-orm@0.45.2, jose@6.2.12, zod@4.6.5

## Folders

Dotted: types only.

```mermaid
flowchart LR
  nhandoff_ts["handoff.ts"]
  nindex_ts["index.ts"]
  nschema_ts["schema.ts"]
  nverify_ts["verify.ts"]
  nvitest_config_ts["vitest.config.ts"]
  nindex_ts --> nhandoff_ts
  nindex_ts --> nschema_ts
  nindex_ts --> nverify_ts
```

## Files

- handoff.ts
- index.ts
- schema.ts
- verify.ts
- vitest.config.ts

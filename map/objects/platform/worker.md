---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: apps/worker/src/lambda.ts:16
---

# worker

`apps/worker`: the Restate endpoint. `main.ts` serves on :9080 locally; `lambda.ts` serves the same services to Restate Cloud from AWS Lambda. Not the Cloudflare Workers.

## Why this shape

Cold start pulls the secret env and the roster from SSM, builds the services, hands the handler to Restate; every invocation is one journaled step (`lambda.ts:1`). The pool is per instance and small, through PgBouncer when `WREN_DATABASE_POOL_PORT` is set (`services.ts:225`). `@wren/core/content/box` wakes the autobrowse EC2 box before a `sites` call and tags who booted it (`box.ts:41`).

## Shape

- `main.ts` (local), `lambda.ts:16`–`18` (SSM env + roster), `ssm-env.ts:35`, `services.ts:105`
- build: `pnpm --filter @wren/worker build:lambda` (esbuild bundle; `createRequire` lesson in `deploy/`). The zip carries `drizzle/` (SQL + journal) beside `app/`, so `app/lambda.mjs` and `app/box.mjs` can migrate a new client; the build fails if the journal and SQL files disagree
- infra: `deploy/terraform/lambda.tf` (function, SSM params `:4`, `:16`, IAM `:56`)

Citations: `apps/worker/src/lambda.ts:16`, `apps/worker/src/services.ts:110`

## Connected to

- **owns:** [[platform/restate-services]]
- **joins:** [[platform/settings]], [[email/roster]], [[processes/deploy]]

## If you change this

- **Hits:** `deploy.yml:32`–`:55`, `deploy/terraform/lambda.tf`, `scripts/register-worker.sh`, `walkthrough/04-production.md`
- **Does not hit:** `apps/phone`, `deploy/pixel`, `deploy/prober`

## Surfaces

| Surface | Role |
|---|---|
| Restate Cloud | invokes |
| CI | builds and publishes a version |

## See

- Source: `apps/worker/src/lambda.ts`

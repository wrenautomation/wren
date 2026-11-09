---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: apps/worker/src/lambda.ts:16
---

# worker

`apps/worker`: the runtime host (`rt.ts:1`). `box.ts` runs it on the box: dispatcher, door (slot port + 10) and the box lane, on 127.0.0.1:9080 or :9081; each deploy takes the other slot, so calls pinned to the last build finish on it (`box-slot.ts:1`, `rt.box_builds`). `lambda.ts` is the Lambda lane: one handler turn per invoke. `main.ts` runs all of it locally, door on :8080. Not the Cloudflare Workers.

## Why this shape

Cold start pulls the secret env and the roster from SSM and builds the services; each invoke runs one turn of one invocation, which replays its journal (`lambda.ts:1`, `rt.ts:296`). The pool is per instance and small, through PgBouncer when `WREN_DATABASE_POOL_PORT` is set (`services/deps.ts:167`). `@wren/core/autobrowse/box` wakes the autobrowse EC2 box before a `sites` call and tags who booted it (`box.ts:41`).

## Shape

- `main.ts` (local), `lambda.ts:16`–`18` (SSM env + roster), `ssm-env.ts:35`, `services.ts:80`
- build: `pnpm --filter @wren/worker build:lambda` (esbuild bundle; `createRequire` lesson in `deploy/`). The zip carries `drizzle/` (SQL + journal) beside `app/`, so `app/lambda.mjs` and `app/box.mjs` can migrate a new client; the build fails if the journal and SQL files disagree
- infra: `deploy/terraform/lambda.tf` (function, SSM params `:4`, `:16`, IAM `:56`)

Citations: `apps/worker/src/lambda.ts:16`, `apps/worker/src/services.ts:80`

## Connected to

- **owns:** [[platform/restate-services]]
- **joins:** [[platform/settings]], [[email/roster]], [[processes/deploy]]

## If you change this

- **Hits:** `deploy/scripts/deploy.sh`, `deploy/scripts/box-worker.sh`, `deploy/terraform/lambda.tf`, `walkthrough/04-production.md`
- **Does not hit:** `apps/phone`, `deploy/pixel`, `deploy/vps`

## Surfaces

| Surface | Role |
|---|---|
| runtime dispatcher (box) | invokes the Lambda lane |
| CI | builds and publishes a version |

## See

- Source: `apps/worker/src/lambda.ts`

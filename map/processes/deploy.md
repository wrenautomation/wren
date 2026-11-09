---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[platform/worker]]", "[[platform/db-schema]]", "[[platform/settings]]", "[[platform/phone-worker]]"]
produces: ["[[platform/restate-services]]"]
---

# deploy

A green push to main is a deploy: migrate, start a new box worker slot, publish a Lambda version and hand it to the box, then the four Cloudflare Workers go live together.

## Input → Movement → Output

The `ci` workflow's lint, unit and schema gates passing on `main`. `deploy` starts the bundles, the box services (SSM) and a not-live version upload of each Cloudflare Worker at once. It runs `pnpm db:migrate`, starts the box worker's new slot (it takes every new row; the old slot finishes its pinned rows, `rt.box_builds`), publishes a new function version and hands it to the box's Lambda lane, then sends each Worker's uploaded version all traffic (`wrangler versions deploy`). Script: `deploy/scripts/deploy.sh`. Output: the new services live, loops resume where their journals left them.

## Why this shape

Never ask before deploying; CI is the only path to prod. Migrations run first so a new bundle never meets an old schema. The Workers go live last so new portal code never calls an old worker. Secrets are not in CI: the Lambda reads SSM at cold start.

## Steps

1. Gates (`.github/workflows/ci.yml:14`–`16`; `scripts/gates.sh`).
2. Trigger: `ci.yml` job `deploy` calls `deploy.yml` (`workflow_call`) beside the gates.
3. `deploy/scripts/deploy.sh`: bundle and upload not-live Workers, `await_gates` (`ci-steps.sh`), migrate (clients side by side), box worker slot, publish the Lambda, hand its version to the box, Workers live.
4. Secrets: `deploy/scripts/push-secrets.sh` writes SSM `/wren/prod/env` and `/wren/prod/senders_config` by hand, never from CI.
5. Infra: `deploy/terraform/` (Lambda, SSM, IAM, media bucket); the Postgres host is EC2 Docker per `walkthrough/04-production.md`.

## If you change this

- **Hits:** `walkthrough/04-production.md`, `docs/operations.md`, the `production` GitHub environment's secrets
- **Does not hit:** the lander (its own CI) or autobrowse (its own box release)

## Surfaces

| Surface | Role |
|---|---|
| GitHub Actions | runs |
| William | pushes; runs `push-secrets.sh` when env changes |

## See

- Objects: [[platform/worker]]
- Source: `.github/workflows/deploy.yml`

---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[platform/worker]]", "[[platform/db-schema]]", "[[platform/settings]]", "[[platform/phone-worker]]"]
produces: ["[[platform/restate-services]]"]
---

# deploy

A green push to main is a deploy: migrate, bundle, publish a Lambda version, register it with Restate on the box, deploy the phone Worker.

## Input → Movement → Output

The `ci` workflow (lint, unit, integration gates) succeeding on `main`. `deploy` runs `pnpm db:migrate`, `build:lambda`, publishes a new function version, registers the endpoint with Restate on the box (over SSM), then `wrangler deploy` for `apps/phone`. Output: the new services live, loops resume where their journals left them.

## Why this shape

Never ask before deploying; CI is the only path to prod. Migrations run first so a new bundle never meets an old schema. Secrets are not in CI: the Lambda reads SSM at cold start.

## Steps

1. Gates (`.github/workflows/ci.yml:14`–`16`; `scripts/gates.sh`).
2. Trigger (`.github/workflows/deploy.yml:9`–`20`).
3. Migrate (`deploy.yml:29`), bundle (`:32`), publish (`:38`), register (`:47`), phone (`:65`).
4. Secrets: `deploy/scripts/push-secrets.sh` writes SSM `/wren/prod/env` and `/wren/prod/senders_config` by hand, never from CI.
5. Infra: `deploy/terraform/` (Lambda, SSM, IAM, media bucket); the Postgres host is EC2 Docker per `walkthrough/04-production.md`.

## If you change this

- **Hits:** `walkthrough/04-production.md`, `docs/restate-operations.md`, the `production` GitHub environment's secrets
- **Does not hit:** the lander (its own CI) or autobrowse (its own box release)

## Surfaces

| Surface | Role |
|---|---|
| GitHub Actions | runs |
| William | pushes; runs `push-secrets.sh` when env changes |

## See

- Objects: [[platform/worker]]
- Source: `.github/workflows/deploy.yml`

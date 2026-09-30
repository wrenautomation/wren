---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/config/src/index.ts:7
---

# settings

Every knob, parsed once from `WREN_*` env into a typed `Settings` object. `settingsSchema` is the list; nothing reads `process.env` after `loadSettings`.

## Why this shape

One zod schema with one field→env map (`index.ts:234`–`315`) means a missing or malformed value fails at start, not mid-run, and a card can name the env var by reading one file. `.env` is found by walking up from cwd, or the launcher's root wins outside the repo (`env-file.ts:12`). In prod the values come from one SSM SecureString applied to `process.env` before settings load (`apps/worker/src/ssm-env.ts:35`).

## Shape

- `settingsSchema` (`index.ts:7`), `Settings` (`:219`), `loadSettings` (`:328`); 81 distinct `WREN_*` names in the file
- families: `WREN_DATABASE_URL`, `WREN_RESTATE_INGRESS_URL` + `RESTATE_AUTH_TOKEN`, `WREN_LLM` + `WREN_LLM_MODEL`, `WREN_VERIFIER` + `WREN_SMTP_PROBE_*`, `WREN_SEND_*` + `WREN_COLD_SENDS_*` + `WREN_NEW_OPENERS_PER_DAY`, `WREN_SEND_TRANSPORT` + `WREN_GOOGLE_SERVICE_ACCOUNT`, `WREN_NOTIFY` + `WREN_DISCORD_WEBHOOK_URL`, `WREN_COMPOSE_DAYS_AHEAD`, `WREN_POOL_MODEL_STAGES`, `WREN_BOUNCE_*` + `WREN_HEALTH_WINDOW_DAYS`, `WREN_OPEN_TRACKING` + `WREN_PIXEL_*`, `WREN_POSTMASTER_USER`, `WREN_REPORT_TO/FROM`, `WREN_CONTENT_CHANNELS` + `WREN_CONTENT_VOICE`, `WREN_MEDIA_BUCKET`, `WREN_META_*` + `WREN_ADS_PAUSE_AFTER_USD`, `WREN_SMS_*` + `WREN_TELNYX_*`, `WREN_AUTOBROWSE_INSTANCE_ID`, `WREN_REDDIT_*`, `WREN_BOOKS_*` (`index.ts:325`)
- prod values: `deploy/prod.env` → `deploy/scripts/push-secrets.sh:34` → SSM `/wren/prod/env` (never push a stale file: it disables live channels)

Citations: `packages/config/src/index.ts:7`, `:328`

## Connected to

- **owns:** [[email/send-policy]]; which services bind in `apps/worker/src/services.ts:110`
- **joins:** [[platform/worker]], [[platform/cli]] (both call `loadSettings`)

## If you change this

- **Hits:** adding a key: `settingsSchema` + the env map + `deploy/prod.env` + the SSM push + `walkthrough/00-setup.md`; the worker's `summary` line
- **Does not hit:** the roster (a file, not env); autobrowse's own env store

## Surfaces

| Surface | Role |
|---|---|
| `.env` (dev), SSM (prod) | write |
| every entry point | reads once |

## See

- Source: `packages/config/src/index.ts`

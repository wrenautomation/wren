# Wren production: what is live and how to run it

2026-09-19. Companion to `restate-durability.md` (why it survives crashes) and
`deploy/README.md` (setup runbook).

## What is live

| | |
|---|---|
| Restate Cloud | env `wren-automation` (`env_201m2vp6sq3x11xdaatsmjej302`), region `us` |
| Deployment | the latest `restate deployments list` row → Lambda `wren-prod-worker` (CI publishes a new version per push to main), 13 services |
| Compute | AWS Lambda, us-east-1, Node 22 arm64, 1 GB, 15 min max per invocation |
| State | Postgres 17 in Docker on EC2 `t4g.small` (`i-04f8cb57c91e84126`), own EBS volume, TLS-only, nightly dump → S3 (30-day expiry) |
| Browser | browserless Chromium on the same box, token-gated, over CDP (`WREN_RENDERER=cdp`) |
| Secrets | one SSM SecureString `/wren/prod/env`, loaded once at cold start |
| Smoke | `POST /SendScheduler/smoke/status` via ingress → `200 {"running":false,"onRoster":false}` |
| Roster | `senders_config.toml` in the bundle since cutover (2026-09-19); `wren email senders list` shows it |

```
you / CLI / curl ──ingress :8080, API key──▶ Restate Cloud (journal, timers, object state)
Restate Cloud ──assume wren-prod-restate-invoker──▶ Lambda wren-prod-worker
Lambda ──cold start──▶ SSM /wren/prod/env
Lambda ──TLS 5432──▶ Postgres on EC2
Lambda ──CDP :3000──▶ browserless
Lambda ──Gmail API (domain-wide delegation)──▶ Gmail
GitHub Actions (main) ──OIDC role──▶ update Lambda code, publish version, register with Restate
```

Restate Cloud is the only always-on piece. It holds every loop's timer and
state. Lambda runs only when Restate invokes it, so a loop asleep for 14 hours
costs nothing and has no process to crash.

## AWS resources (24, all Terraform in `deploy/terraform/`)

| Resource | Job | ≈ cost/mo |
|---|---|---|
| EC2 `t4g.small` (AL2023 ARM) | Postgres + browserless in Docker | $12 |
| EBS gp3 20 GB | DB data, survives instance rebuild | $2 |
| Elastic IP | fixed DB address | $0 while attached |
| Security group | 5432 (TLS Postgres) and 3000 (browser, token) only | $0 |
| S3 bucket | nightly `pg_dump -Fc`, 30-day lifecycle | pennies |
| Lambda `wren-prod-worker` + log group | the worker | ≈ $0 at this volume |
| SSM params `/wren/prod/{pg_password,browser_token,env}` | secrets | $0 |
| IAM: instance role, Lambda role, `wren-prod-restate-invoker`, `wren-prod-ci` + GitHub OIDC provider | who may do what | $0 |

Total ≈ $15/month. Restate Cloud is on the free tier.

## Operating

### Ingress (any HTTP client; API key from Developers → API keys)

```sh
H="Authorization: Bearer $RESTATE_AUTH_TOKEN"     # in wren/.env
U=https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080

curl -X POST -H "$H" $U/SendScheduler/alice@example.com/status
curl -X POST -H "$H" $U/SendScheduler/alice@example.com/start
curl -X POST -H "$H" $U/SendScheduler/alice@example.com/stop
curl -X POST -H "$H" $U/InboxScheduler/alice@example.com/sync
curl -X POST -H "$H" $U/PostmasterScheduler/fleet/start
curl -X POST -H "$H" $U/OpensScheduler/fleet/start
curl -X POST -H "$H" $U/ReportScheduler/weekly/start   # Friday 19:00 report; /sync mails one now
curl -X POST -H "$H" $U/ComposeScheduler/agencies/start # keep 3 send days of approved openers queued; /sync tops up now
curl -X POST -H "$H" $U/DigestScheduler/fleet/start     # 07:00 fleet-clock digest to Discord; /sync posts one now
```

### CLI (already configured for this env)

```sh
restate services list                 # the 13 services and revisions
restate invocations list              # running and sleeping loops, with wake times
restate invocations describe <id>     # one invocation's journal
restate services status SendScheduler # per-key state
restate deployments list
```

The Cloud UI (Overview → service → Playground) calls any handler from a form;
Invocations shows every sleeping loop and when it wakes.

### Logs

```sh
aws logs tail /aws/lambda/wren-prod-worker --since 1h --follow
```

Cold start prints one summary line: llm, verifier, renderer, transport,
sender count. `senders: 0` until cutover.

### DB box

```sh
cd deploy/terraform
aws ssm start-session --target "$(tofu output -raw pg_instance_id)"   # shell, no SSH keys
# on the box: docker ps; tail /var/log/wren-user-data.log; tail /var/log/wren-pg-backup.log
```

Migrations from a laptop (URL never echoed):

```sh
WREN_DATABASE_URL="$(cd deploy/terraform && tofu output -raw database_url)" pnpm db:migrate
```

### Deploying a change

Push to `main` → `ci` green → `deploy.yml`: migrations against prod, build
zip, publish a new Lambda version, register it with Restate. Old versions keep
serving in-flight invocations; new invocations go to the new version. When
`restate invocations list` shows none on the old deployment, remove it.

GitHub environment `production` secrets: `AWS_DEPLOY_ROLE_ARN`,
`AWS_INVOKE_ROLE_ARN`, `LAMBDA_NAME`, `WREN_DATABASE_URL`, `RESTATE_HOST`,
`RESTATE_AUTH_TOKEN`. Mirror: `deploy/github-secrets.env`.

### Changing env vars

Edit `deploy/prod.env`, run `deploy/scripts/push-secrets.sh`, then force a new
cold start (publish a version, or `aws lambda update-function-configuration
--function-name wren-prod-worker --description "bump"`).

## The campaign, end to end

Nothing is by hand once a niche has leads. `ComposeScheduler/{niche}` runs once a day
(local midnight): capacity = active inboxes × today's per-inbox cap; it keeps
`WREN_COMPOSE_DAYS_AHEAD` (3) days of approved openers queued, composing the shortfall
through the niche's enrollment plan (`packages/niches/src/<niche>.ts` `plan`: agencies
route by `agency_facts.segment`, marketing → `marketing-days-0-5`, build →
`build-days-0-5`, unsegmented → marketing). Every draft is auto-approved and pins the
sign-off with the niche's page (`/agencies`, `/ria`), so the copy and the site agree.
`SendScheduler/{inbox}` sends them inside the window at the ramp; `InboxScheduler`
reads replies and bounces; kill switches pause a domain at 2% bounces. `status` on the
compose object shows the last pass: `queued`, `target`, `enrolled`, `exhausted` (pool
empty: import more leads or verify more addresses).

## Feeding the pool

`exhausted: true` on the compose object means every company with a sendable
address is enrolled. Growth is the research chain. `PoolScheduler/{niche}` walks
it: one bounded call per stage per pass, another pass a minute later while any
stage still finds work, then sleep until the next local day. What may call the
model is `WREN_POOL_MODEL_STAGES`: `none` (default — discover, crawl, render, scan
only; no verdicts, so no new leads yet), `pick` (one model call per company with
more than one address; this is what turns role inboxes into leads), `all`
(extraction too, one call per stored page — the expensive one).

```sh
curl -X POST -H "$H" $U/PoolScheduler/sec_ria/start    # /status shows per-stage progress and errors
curl -X POST -H "$H" $U/PoolScheduler/agencies/start
```

The stages by hand, keyed by niche (`all` = every niche); each reports what it moved:

```sh
curl -X POST -H "$H" $U/Discovery/sec_ria/discover -d '{"limit":25}'   # name → domain, DoH + homepage gate, free
curl -X POST -H "$H" $U/Discovery/sec_ria/verify   -d '{"limit":25}'   # prove asserted domains, free
curl -X POST -H "$H" $U/Enrichment/sec_ria/crawl   -d '{"limit":10}'   # homepage + contact/team pages
curl -X POST -H "$H" $U/Enrichment/sec_ria/render  -d '{"limit":10}'   # JS shells, through the CDP box
curl -X POST -H "$H" $U/Enrichment/sec_ria/scan    -d '{}'             # addresses in stored pages, deterministic
curl -X POST -H "$H" $U/Enrichment/sec_ria/extract -d '{"limit":20}'   # people + roles, one model call per page (Cohere)
curl -X POST -H "$H" $U/Enrichment/sec_ria/applyExtractions -d '{}'
curl -X POST -H "$H" $U/Enrichment/sec_ria/pick    -d '{"limit":50}'   # best send-to per company; a model call only when ambiguous
curl -X POST -H "$H" $U/Enrichment/sec_ria/applyPicks -d '{}'          # role inboxes → leads (compose picks them up next pass)
curl -X POST -H "$H" $U/Resolution/fleet/build; …/queue; …/resolve     # person guesses → MillionVerifier (free credits only)
```

Pool on 2026-09-20: agencies 5,277 companies without a domain, 471 crawled with no
sendable address (42 of them person guesses waiting on credits); sec_ria 19,237 domains,
5 crawled. Resolution (person guesses → MillionVerifier) stays by hand: it spends credits.

## Discord (what you get told, and what you never get told)

`WREN_NOTIFY=discord` + `WREN_DISCORD_WEBHOOK_URL` (in `deploy/prod.env` → SSM; the URL
authorises posting, so it is a secret). Counts only, never a reply's text or a lead's
address:

- `N new replies in <inbox>` after an inbox sync that found humans (answer from Gmail).
- `N hard bounces, N unsubscribes via <inbox>` (warning).
- `kill switch paused N inboxes` with sender and reason; `wren email senders resume` lifts it.
- `<niche>: the pool ran dry` from the queue-keeper when the plan has nothing left to enroll.
- `<stage> · <key> failed` once when a loop starts failing, `recovered` once when it stops.
- `digest for YYYY-MM-DD` at 07:00 fleet clock: per domain sent / hard bounces / replies /
  unsubscribes / newest Postmaster spam rate, then the queue.

`WREN_NOTIFY=none` (the default) binds no `DigestScheduler` and every loop stays silent.

## Things to watch

- **Postgres is on the public internet** (TLS-only, scram, 32-byte password)
  because Lambda has no fixed IP and a NAT gateway costs more than the box.
  Rotate: change `pg_password` in `terraform.tfvars`, `tofu apply`, update
  `WREN_DATABASE_URL` in `prod.env`, `push-secrets.sh`, new cold start.
- **Backups are dumps, not point-in-time.** 08:00 UTC daily. A bad write at
  14:00 loses up to a day of ledger.
- **Restate invoker trust policy** came from `@restatedev/restate-cdk`
  (account `654654156625`, role `RestateCloud`, external id = env id) because
  the Cloud UI showed none. If Restate rotates that principal, registration
  breaks with an AssumeRole error; re-check the CDK package or UI.
- **AWS account.** IAM user + MFA + budget done. Use the IAM user for the CLI
  (`aws login` as that user, or an access key + `aws configure`), keep root
  for billing only.
- **Terraform state is local** (`deploy/terraform/terraform.tfstate`,
  gitignored). Back it up with the other private files; losing it means
  importing 24 resources by hand.

## Where things are

| | |
|---|---|
| Terraform | `deploy/terraform/` — `tofu plan` / `tofu apply` |
| Runbook | `deploy/README.md` |
| Lambda entry | `apps/worker/src/lambda.ts`; services wired in `apps/worker/src/services.ts` |
| Loop primitive | `packages/channel-email/src/restate/loop.ts`; send loop `send-scheduler.ts` |
| Secrets (gitignored, chmod 600) | `deploy/prod.env`, `deploy/github-secrets.env`, `deploy/terraform/terraform.tfvars`, `.env` |
| CI | `.github/workflows/deploy.yml`, GitHub environment `production` |

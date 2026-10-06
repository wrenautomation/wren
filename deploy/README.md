# Deploy

Restate → AWS Lambda (the worker) → Postgres, all but the Lambda in Docker on one EC2 box.
Since 2026-10-06 Restate runs on the box (`deploy/scripts/box-restate.sh`, `https://restate.wrenautomation.com`);
the Restate Cloud steps below are the way back. Why and how: `designs/2026-10-05-restate-self-host.md`.
Everything here is general wren infrastructure; nothing knows about niches or channels.

```
Restate (box)  --instance role-->  Lambda wren-prod-worker  --TLS-->  EC2 wren-prod-pg :5432
       ^                                          |                                |
  restate CLI / ingress                     SSM /wren/prod/env                nightly pg_dump → S3
```

Region `us-east-1`: Restate Cloud runs there; every journal entry is a round trip.

## One-time setup (you)

1. **AWS account.** Create an IAM user for yourself with admin, then locally: `aws configure`
   (region `us-east-1`). Verify: `aws sts get-caller-identity`.
2. **Restate Cloud.** `restate cloud login`, create an environment in region `us`, then
   `restate cloud env configure`. In the web UI, Developers > Security > AWS Lambda: copy the
   IAM trust policy and the request-identity public key. If the UI does not show a trust
   policy, use the one `@restatedev/restate-cdk` generates (principal account `654654156625`,
   `aws:PrincipalArn` = `arn:aws:iam::654654156625:role/RestateCloud`, `sts:ExternalId` = your
   env id, plus an `sts:TagSession` statement for the same account). The identity key is
   optional on Lambda: IAM already restricts who can invoke.
3. **Render tier.** Default: browserless chromium on the Postgres box (`browser_token` in
   tfvars; nothing to sign up for). Or Browserbase (an API key and project id; leave
   `browser_token` empty) if the box is too small for a browser.
4. **Secrets file.** `cp deploy/prod.env.example deploy/prod.env` and fill it (gitignored).

## First deploy

```sh
pnpm --filter @wren/worker build:lambda            # apps/worker/dist/lambda.zip
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars       # pg_password, restate_trust_policy, restate_identity_key
tofu init && tofu apply                            # ~3 min; the box initialises itself on first boot
tofu output -raw database_url                      # → WREN_DATABASE_URL in deploy/prod.env
cd ..
scripts/push-secrets.sh                            # deploy/prod.env → SSM /wren/prod/env; roster → /wren/prod/senders_config
WREN_DATABASE_URL="$(cd terraform && tofu output -raw database_url)" pnpm db:migrate
```

Register the worker with Restate Cloud (CI does this on every push afterwards):

```sh
ARN=$(cd deploy/terraform && tofu output -raw lambda_arn)
ROLE=$(cd deploy/terraform && tofu output -raw restate_invoker_role_arn)
restate deployments register "$ARN:1" --assume-role-arn "$ROLE"
```

Smoke: `restate services list` shows Enrichment, Resolution, SendScheduler,
InboxScheduler, Disposition (+ PostmasterScheduler / OpensScheduler when configured). Then
`pnpm wren db check` with `WREN_DATABASE_URL` pointed at the box, and one invocation:
`curl -H "Authorization: Bearer $RESTATE_AUTH_TOKEN" https://<env>.env.us.restate.cloud:8080/SendScheduler/<sender>/status`.

## CI (GitHub → Lambda)

`.github/workflows/deploy.yml` runs after `ci` is green on `main`: migrate, bundle, publish a
Lambda version, register it. Repo secrets, from `tofu output` and the Restate UI:

| secret | value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `ci_role_arn` |
| `AWS_INVOKE_ROLE_ARN` | `restate_invoker_role_arn` |
| `LAMBDA_NAME` | `lambda_name` |
| `WREN_DATABASE_URL` | `database_url` |
| `RESTATE_HOST` | `<env id>.env.us.restate.cloud`, or `restate.wrenautomation.com` once self-hosted (CI then registers over SSM) |
| `RESTATE_AUTH_TOKEN` | an API key from Developers > API keys, or the box's `token` in `/wren/prod/restate` |
| `WREN_DISCORD_WEBHOOK_URL` | the ops webhook, for `restate-lag.yml` |

If the deploy job fails at `configure-aws-credentials` with "Not authorized to perform
sts:AssumeRoleWithWebIdentity", the repo uses GitHub's immutable OIDC subjects:
`gh api repos/{owner}/{repo}/actions/oidc/customization/sub` shows `sub_claim_prefix`; put it
in `terraform.tfvars` as `github_sub_prefix` and `tofu apply`.

Create a `production` environment in the repo settings (the job targets it; add a required
reviewer there if you want a manual gate).

Migrations run before the new code is live: keep them additive (expand first, contract in a
later release) so the version still serving does not break.

## Day 2

- Logs: `aws logs tail /aws/lambda/wren-prod-worker --follow`.
- Change a secret: edit `deploy/prod.env`, `deploy/scripts/push-secrets.sh`. The env is read at cold
  start, and Restate calls a published version, so a config change on `$LATEST` does not recycle it:
  the change lands at the next CI deploy (a new version) or when Lambda retires the old instances (hours).
  push-secrets overwrites the whole parameter: diff SSM against prod.env first, or a key set only in
  SSM (e.g. `WREN_NEW_OPENERS_PER_DAY`) is dropped.
- Change the roster: edit `senders_config.toml` at the repo root (gitignored), run
  `deploy/scripts/push-secrets.sh` (writes SSM `/wren/prod/senders_config`), force new instances as
  above. The Lambda reads the roster from SSM at cold start; the bundle never carries it, so
  CI builds (which have no roster) deploy the same fleet.
- Add a sending domain: autobrowse's `domain` workflow (buy, DNS, Workspace, inboxes with
  password + TOTP, Instantly warmup, roster, loops); see `autobrowse/designs/2026-09-19-domain-flow.md`.
  It writes the roster here and starts `SendScheduler`/`InboxScheduler` for each inbox.
- Shell on the box: `aws ssm start-session --target $(cd deploy/terraform && tofu output -raw pg_instance_id)`.
  Postgres is `docker exec -it wren-pg psql -U wren`. First-boot log: `/var/log/wren-user-data.log`.
- Backups: nightly `pg_dump -Fc` to the `backups_bucket`, 30-day expiry. Restore:
  `aws s3 cp s3://<bucket>/pg/<date>.dump - | docker exec -i wren-pg pg_restore -U wren -d wren --clean`.
- Rebuild the box: `tofu taint aws_instance.pg && tofu apply`. The data volume, its TLS cert and
  the Elastic IP survive; `database_url` does not change.
- Lambda config (memory, timeout, env) is Terraform's; code is CI's (`ignore_changes` on the zip).

## Security posture, plainly

- Postgres listens on the internet: TLS required (`hostnossl … reject`), scram auth, a 32-byte
  password, no SSH port, IMDSv2. The cert is self-signed, so clients use `sslmode=require`
  (encrypted, unverified). Move to a VPC + NAT when the bill justifies it.
- Secrets live in one SSM SecureString the Lambda role alone can read; never in Terraform state
  except `pg_password` (state is local and gitignored).
- The Restate invoker role can only invoke this function; the CI role can only replace its code.
- The browser container listens on 3000 behind a token in the URL, over plain `ws://`. It
  renders public web pages and nothing else; Lambda → EC2 in one region stays on AWS's network.

## Later

- Self-hosted Restate on Kubernetes when Cloud's free tier is outgrown: the Lambda becomes a
  Deployment serving `apps/worker/src/main.ts`; nothing else changes.
- State backend to S3 the day a second operator or environment exists.

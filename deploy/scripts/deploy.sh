#!/usr/bin/env bash
# The deploy, run by .github/workflows/deploy.yml in one step: background work (`bg`) dies
# with the step that starts it, so every phase shares this shell. Helpers: ci-steps.sh.
# The order that matters:
#   build and upload (not live) → the gates pass → migrate → publish the Lambda
#   → register it with Restate (Cloud or the box) → Cloudflare goes live.
# ci.yml starts this job beside lint, unit and schema: the builds and not-live uploads run while
# they check. Nothing touches the box, the database or live traffic before all three pass.
#   pgbouncer → the box's pool-chain worker → register;  pgbouncer + valkey → publish the Lambda.
# The phone, sign-in, portal and LLM gateway Workers upload a version early and take traffic
# only after Restate registers, all four within seconds.
set -euo pipefail
. deploy/scripts/ci-steps.sh
phase() { echo "::notice::$(date -u +%T) $*"; }

# RESTATE_HOST names Restate Cloud (ingress on :8080, admin API public) or the box
# (restate.wrenautomation.com: ingress through Caddy on 443, admin on its loopback).
case "$RESTATE_HOST" in
  *.restate.cloud) RESTATE_INGRESS="https://$RESTATE_HOST:8080" ;;
  *) RESTATE_INGRESS="https://$RESTATE_HOST" ;;
esac

# Everything that changes nothing live starts now: the two Lambda bundles, the CLI bundle
# (templates sync runs it), and a not-yet-live version of each Cloudflare Worker.
# After the gates: the box's pgbouncer, valkey and listmonk, beside the migrations.
# Phone: the ingress follows RESTATE_HOST like the portal's; its other secrets (Telnyx, cal.com,
# Gmail push, credential links) are set by hand and kept: --secrets-file is additive.
# LLM gateway: its keys are Worker secrets, set by scripts/llm-gateway-keys.mjs; a deploy keeps them.
# Portal: LAMBDA_URL, EDGE_SECRET: a client's own host redeems sign-ins at the auth Lambda.
# pgbouncer: before the box worker and the Lambda, which may connect through it (WREN_DATABASE_POOL_PORT).
# valkey: before the Lambda, which reads through it (WREN_CACHE_URL). Unchanged: left running.
# listmonk: the newsletter (designs/2026-10-21-esign-and-newsletter.md); no SSM param
# /wren/prod/listmonk yet: the script says so and skips. Unchanged: left running.
phase start
jq -n --arg url "$RESTATE_INGRESS/" --arg token "$RESTATE_AUTH_TOKEN" \
  '{RESTATE_INGRESS_URL: $url, RESTATE_AUTH_TOKEN: $token}' > "$RUNNER_TEMP/phone-secrets.json"
jq -n --arg url "$LAMBDA_URL" --arg edge "$EDGE_SECRET" '{LAMBDA_URL: $url, EDGE_SECRET: $edge}' \
  > "$RUNNER_TEMP/auth-secrets.json"
jq -n --arg url "$RESTATE_INGRESS/" --arg token "$RESTATE_AUTH_TOKEN" \
  --arg lambda "$LAMBDA_URL" --arg edge "$EDGE_SECRET" \
  '{RESTATE_INGRESS_URL: $url, RESTATE_AUTH_TOKEN: $token, LAMBDA_URL: $lambda, EDGE_SECRET: $edge}' \
  > "$RUNNER_TEMP/portal-secrets.json"
bg worker-zip pnpm --filter @wren/worker build:lambda
bg auth-zip pnpm --filter @wren/auth-app build:lambda
bg cli node apps/cli/scripts/build.mjs
bg up-phone cf_upload phone "$RUNNER_TEMP/phone-secrets.json"
bg up-gateway cf_upload llm-gateway
bg up-auth cf_upload auth "$RUNNER_TEMP/auth-secrets.json"
bg up-portal cf_upload portal "$RUNNER_TEMP/portal-secrets.json"

# A run by hand (workflow_dispatch) has no gates of its own. Any other run waits: an
# unexpected event name finds no gates and runs out (20 min) with nothing live changed.
if [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]; then
  phase gates
  await_gates
fi

phase migrate
bg pgbouncer box_script pgbouncer box-pgbouncer.sh
bg valkey box_script valkey box-valkey.sh us-east-1
bg listmonk box_script listmonk box-listmonk.sh us-east-1
pnpm db:migrate
await cli
# templates: each changed file in packages/templates/defaults as a default version, in every database.
bg templates pnpm -s wren templates sync

# Restate keeps a service on the deployment that last offered it, and this Lambda build
# leaves the pool chain out (WREN_POOL_CHAIN_HOST=box): the box worker restarts before registering.
# The sign-in Lambda's function URL serves $LATEST; no version to publish.
phase "box worker and lambdas"
await worker-zip auth-zip pgbouncer
key="worker/$GITHUB_SHA.zip"
aws s3 cp --only-show-errors apps/worker/dist/lambda.zip "s3://$BOX_BUCKET/$key"
bg box-worker box_script worker box-worker.sh "$BOX_BUCKET" "$key"
bg auth-lambda sh -c 'aws lambda update-function-code --function-name wren-prod-auth \
  --zip-file fileb://apps/auth/dist/lambda.zip > /dev/null && aws lambda wait function-updated --function-name wren-prod-auth'
await valkey
aws lambda update-function-code --function-name "$LAMBDA_NAME" \
  --zip-file fileb://apps/worker/dist/lambda.zip --publish --output json > "$RUNNER_TEMP/publish.json"
# A versioned ARN, whichever form the response's FunctionArn takes.
ARN="$(jq -r .FunctionArn "$RUNNER_TEMP/publish.json" | sed -E 's/:[0-9]+$//'):$(jq -r .Version "$RUNNER_TEMP/publish.json")"
await box-worker

phase register
case "$RESTATE_HOST" in
  *.restate.cloud)
    npx -y @restatedev/restate deployments register -y "$ARN" --assume-role-arn "$INVOKE_ROLE" ;;
  *)
    # The box's own role invokes the Lambda; its admin API answers on loopback only.
    # Discovery invokes the new version, which may still be pending: retry while it warms.
    # (No `aws lambda wait`: the CI role has no GetFunctionConfiguration.)
    # First, drop deployments nothing uses: Restate caps them all at 30.4 MiB.
    body="$(jq -nc --arg arn "$ARN" '{arn: $arn}')"
    # The watch pings Discord when Restate itself is down, which nothing inside it can.
    prune="$(base64 -w0 deploy/scripts/restate-prune.py)"
    watch="$(base64 -w0 deploy/scripts/restate-watch.py)"
    jq -n --arg b "$body" --arg p "$prune" --arg w "$watch" '{commands: [
      "echo \($p) | base64 -d > /usr/local/bin/wren-restate-prune",
      "echo \($w) | base64 -d > /usr/local/bin/wren-restate-watch",
      "chmod 755 /usr/local/bin/wren-restate-prune /usr/local/bin/wren-restate-watch",
      "echo \"17 * * * * root /usr/local/bin/wren-restate-prune >> /var/log/wren-restate-prune.log 2>&1\" > /etc/cron.d/wren-restate-prune",
      "echo \"*/5 * * * * root /usr/local/bin/wren-restate-watch >> /var/log/wren-restate-watch.log 2>&1\" > /etc/cron.d/wren-restate-watch",
      "/usr/local/bin/wren-restate-prune || true",
      "for i in $(seq 1 50); do curl -sS --fail-with-body -X POST http://127.0.0.1:9070/deployments -H content-type:application/json -d \($b | @sh) -o /tmp/register.out && exit 0; head -c 400 /tmp/register.out; sleep 2; done; exit 1"]}' \
      > "$RUNNER_TEMP/register.json"
    ssm_run register "$RUNNER_TEMP/register.json" ;;
esac

phase "cloudflare live"
await up-phone up-gateway up-auth up-portal
bg live-phone cf_flip phone "$RUNNER_TEMP/phone-secrets.json"
bg live-gateway cf_flip llm-gateway
bg live-auth cf_flip auth "$RUNNER_TEMP/auth-secrets.json"
bg live-portal cf_flip portal "$RUNNER_TEMP/portal-secrets.json"
await live-phone live-gateway live-auth live-portal

# Queued email was saved at compose; this re-renders it from the templates just shipped.
# Fire and forget: the run lands in the runs ledger (`outreach refresh`).
phase "queued mail"
await templates
curl -fsS -X POST "$RESTATE_INGRESS/QueueRefresh/all/send" \
  -H "Authorization: Bearer $RESTATE_AUTH_TOKEN" -H "content-type: application/json" -d 'null' > /dev/null

await auth-lambda listmonk
phase done

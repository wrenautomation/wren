#!/usr/bin/env bash
# The deploy, run by .github/workflows/deploy.yml in one step: background work (`bg`) dies
# with the step that starts it, so every phase shares this shell. Helpers: ci-steps.sh.
# The order that matters:
#   build and upload (not live) → the gates pass → migrate → the box worker, publish the Lambda
#   → hand the box the Lambda version → Cloudflare goes live.
# ci.yml starts this job beside lint, unit and schema: the builds and not-live uploads run while
# they check. Nothing touches the box, the database or live traffic before all three pass.
#   pgbouncer → the box worker (the runtime, apps/worker/src/rt.ts) → publish the Lambda.
# The phone, sign-in, portal and LLM gateway Workers upload a version early and take traffic
# only after the box has the new Lambda version, all four within seconds.
set -euo pipefail
. deploy/scripts/ci-steps.sh
phase() { echo "::notice::$(date -u +%T) $*"; }

# RESTATE_HOST: the runtime's door (api.wrenautomation.com, Caddy on 443, box-front-door.sh).
# Old name, kept until the env names move.
RESTATE_INGRESS="https://$RESTATE_HOST"

# Everything that changes nothing live starts now: the two Lambda bundles, the CLI bundle
# (templates sync runs it), and a not-yet-live version of each Cloudflare Worker.
# After the gates: the box's pgbouncer, listmonk and front door, beside the migrations.
# Phone: the ingress follows RESTATE_HOST like the portal's; its other secrets (Telnyx, cal.com,
# Gmail push, credential links) are set by hand and kept: --secrets-file is additive.
# LLM gateway: its keys are Worker secrets, set by scripts/llm-gateway-keys.mjs; a deploy keeps them.
# Share (autobrowse traces ingest): ADMIN_TOKEN is a kept Worker secret. It serves no prod path,
# so its failure only warns (cf_soft): the first CI run proves the token can bind R2.
# Portal: LAMBDA_URL, EDGE_SECRET: a client's own host redeems sign-ins at the auth Lambda.
# pgbouncer: before the box worker and the Lambda, which may connect through it (WREN_DATABASE_POOL_PORT).
# listmonk: the newsletter (designs/2026-10-21-esign-and-newsletter.md); no SSM param
# /wren/prod/listmonk yet: the script says so and skips. Unchanged: left running.
phase start
jq -n --arg url "$RESTATE_INGRESS/" --arg token "$RESTATE_AUTH_TOKEN" \
  '{RESTATE_INGRESS_URL: $url, RESTATE_AUTH_TOKEN: $token}' > "$RUNNER_TEMP/phone-secrets.json"
jq -n --arg url "$LAMBDA_URL" --arg edge "$EDGE_SECRET" '{LAMBDA_URL: $url, EDGE_SECRET: $edge}' \
  > "$RUNNER_TEMP/auth-secrets.json"
# LIVE_HOOK_SECRET: writers' signed "this changed" (src/topics.ts); = WREN_LIVE_SECRET in SSM.
jq -n --arg url "$RESTATE_INGRESS/" --arg token "$RESTATE_AUTH_TOKEN" \
  --arg lambda "$LAMBDA_URL" --arg edge "$EDGE_SECRET" --arg live "${LIVE_HOOK_SECRET:-}" \
  '{RESTATE_INGRESS_URL: $url, RESTATE_AUTH_TOKEN: $token, LAMBDA_URL: $lambda, EDGE_SECRET: $edge}
   + (if $live == "" then {} else {LIVE_HOOK_SECRET: $live} end)' \
  > "$RUNNER_TEMP/portal-secrets.json"
bg worker-zip pnpm --filter @wren/worker build:lambda
bg auth-zip pnpm --filter @wren/auth-app build:lambda
bg cli node apps/cli/scripts/build.mjs
bg up-phone cf_upload phone "$RUNNER_TEMP/phone-secrets.json"
bg up-gateway cf_upload llm-gateway
bg up-share cf_soft cf_upload share
bg up-auth cf_upload auth "$RUNNER_TEMP/auth-secrets.json"
bg up-portal cf_upload portal "$RUNNER_TEMP/portal-secrets.json"

# A run by hand (workflow_dispatch) has no gates of its own. Any other run waits: an
# unexpected event name finds no gates and runs out (30 min) with nothing live changed.
if [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]; then
  phase gates
  await_gates
fi

phase migrate
bg pgbouncer box_script pgbouncer box-pgbouncer.sh
bg listmonk box_script listmonk box-listmonk.sh us-east-1
bg front-door box_script front-door box-front-door.sh us-east-1
pnpm db:migrate
await cli
# templates: each changed file in packages/templates/defaults as a default version, in every database.
bg templates pnpm -s wren templates sync

# The box worker's new slot takes new rows once up; Lambda rows pin to the version written below.
# The sign-in Lambda's function URL serves $LATEST; no version to publish.
phase "box worker and lambdas"
await worker-zip auth-zip pgbouncer
key="worker/$GITHUB_SHA.zip"
aws s3 cp --only-show-errors apps/worker/dist/lambda.zip "s3://$BOX_BUCKET/$key"
bg box-worker box_script worker box-worker.sh "$BOX_BUCKET" "$key"
bg auth-lambda sh -c 'aws lambda update-function-code --function-name wren-prod-auth \
  --zip-file fileb://apps/auth/dist/lambda.zip > /dev/null && aws lambda wait function-updated --function-name wren-prod-auth'
aws lambda update-function-code --function-name "$LAMBDA_NAME" \
  --zip-file fileb://apps/worker/dist/lambda.zip --publish --output json > "$RUNNER_TEMP/publish.json"
# A versioned ARN, whichever form the response's FunctionArn takes.
ARN="$(jq -r .FunctionArn "$RUNNER_TEMP/publish.json" | sed -E 's/:[0-9]+$//'):$(jq -r .Version "$RUNNER_TEMP/publish.json")"
await box-worker

# The box's lambda lane (apps/worker/src/rt.ts) pins new Lambda rows to this version.
phase "lambda version"
jq -n --arg arn "$ARN" '{commands: [
  "mkdir -p /etc/wren && printf %s \($arn | @sh) > /etc/wren/worker-arn.new && mv /etc/wren/worker-arn.new /etc/wren/worker-arn"]}' \
  > "$RUNNER_TEMP/lambda-version.json"
ssm_run lambda-version "$RUNNER_TEMP/lambda-version.json"

phase "cloudflare live"
await up-phone up-gateway up-auth up-portal up-share
bg live-phone cf_flip phone "$RUNNER_TEMP/phone-secrets.json"
bg live-gateway cf_flip llm-gateway
bg live-share cf_soft cf_flip share
bg live-auth cf_flip auth "$RUNNER_TEMP/auth-secrets.json"
bg live-portal cf_flip portal "$RUNNER_TEMP/portal-secrets.json"
await live-phone live-gateway live-auth live-portal live-share

# Queued email was saved at compose; this re-renders it from the templates just shipped.
# Fire and forget: the run lands in the runs ledger (`outreach refresh`).
phase "queued mail"
await templates
curl -fsS -X POST "$RESTATE_INGRESS/EmailQueueRerender/all/send" \
  -H "Authorization: Bearer $RESTATE_AUTH_TOKEN" -H "content-type: application/json" -d 'null' > /dev/null

await auth-lambda listmonk front-door
phase done

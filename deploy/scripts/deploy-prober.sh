#!/usr/bin/env bash
# Ship apps/prober to the Postgres box: build the bundle, put it and the restart script
# in the backups bucket under prober/, then run the script on the box over SSM (no SSH).
# Needs a logged-in AWS session and the terraform outputs.
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm --filter @wren/prober build >/dev/null
out() { (cd deploy/terraform && tofu output -raw "$1"); }
BUCKET="$(out backups_bucket)"
INSTANCE="$(out pg_instance_id)"
REGION="${AWS_REGION:-us-east-1}"
HELO="$(out probe_helo)"
aws s3 cp apps/prober/dist/prober.mjs "s3://$BUCKET/prober/prober.mjs" >/dev/null
aws s3 cp deploy/scripts/prober-restart.sh "s3://$BUCKET/prober/restart.sh" >/dev/null
echo "uploaded s3://$BUCKET/prober/{prober.mjs,restart.sh}"
CMDS="aws s3 cp --region $REGION s3://$BUCKET/prober/restart.sh /usr/local/bin/wren-prober-restart && chmod +x /usr/local/bin/wren-prober-restart && REGION=$REGION BUCKET=$BUCKET TOKEN_PARAM=/wren/prod/probe_token HELO=$HELO /usr/local/bin/wren-prober-restart"
CMD_ID="$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "wren prober restart" \
  --parameters "commands=[\"$CMDS\"]" \
  --query Command.CommandId --output text)"
for _ in $(seq 1 60); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success)
      aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
        --query StandardOutputContent --output text | tail -1
      exit 0 ;;
    Failed|Cancelled|TimedOut)
      aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
        --query StandardErrorContent --output text; exit 1 ;;
  esac
  sleep 3
done
echo "timed out waiting for SSM command $CMD_ID" >&2; exit 1

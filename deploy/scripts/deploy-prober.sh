#!/usr/bin/env bash
# Ship apps/prober to the Postgres box: build the bundle, put it in the backups bucket
# under prober/, then have the box re-run /usr/local/bin/wren-prober-restart over SSM
# (no SSH). Needs a logged-in AWS session and the terraform outputs.
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm --filter @wren/prober build >/dev/null
BUCKET="$(cd deploy/terraform && tofu output -raw backups_bucket)"
INSTANCE="$(cd deploy/terraform && tofu output -raw pg_instance_id)"
aws s3 cp apps/prober/dist/prober.mjs "s3://$BUCKET/prober/prober.mjs" >/dev/null
echo "uploaded s3://$BUCKET/prober/prober.mjs"
CMD_ID="$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "wren prober restart" \
  --parameters 'commands=["/usr/local/bin/wren-prober-restart"]' \
  --query Command.CommandId --output text)"
for _ in $(seq 1 30); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success) echo "prober restarted on $INSTANCE"; exit 0 ;;
    Failed|Cancelled|TimedOut)
      aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
        --query StandardErrorContent --output text; exit 1 ;;
  esac
  sleep 2
done
echo "timed out waiting for SSM command $CMD_ID" >&2; exit 1

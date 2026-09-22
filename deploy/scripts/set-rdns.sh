#!/usr/bin/env bash
# Point the box's elastic IP back at the prober's HELO name (probe_helo). Mail servers
# compare the two, so a HELO with no matching PTR reads as a stray sender. Idempotent:
# a PTR that already matches is left alone. The forward record (probe_helo -> this IP,
# in Cloudflare) must resolve first, or AWS refuses the update.
set -euo pipefail
cd "$(dirname "$0")/../.."
out() { (cd deploy/terraform && tofu output -raw "$1"); }
IP="$(out pg_host)"
HELO="$(out probe_helo)"
FORWARD="$(dig +short "$HELO" A | head -1)"
[ "$FORWARD" = "$IP" ] || { echo "$HELO resolves to '${FORWARD:-nothing}', not $IP: fix the A record first" >&2; exit 1; }
ALLOC="$(aws ec2 describe-addresses --public-ips "$IP" --query 'Addresses[0].AllocationId' --output text)"
CURRENT="$(aws ec2 describe-addresses-attribute --allocation-ids "$ALLOC" --attribute domain-name \
  --query 'Addresses[0].PtrRecord' --output text 2>/dev/null || echo None)"
if [ "$CURRENT" = "$HELO." ]; then echo "$IP already points at $HELO"; exit 0; fi
aws ec2 modify-address-attribute --allocation-id "$ALLOC" --domain-name "$HELO" \
  --query 'Address.PtrRecordUpdate.Status' --output text
# AWS applies it in a couple of minutes; wait so the caller knows it took.
for _ in $(seq 1 30); do
  PTR="$(aws ec2 describe-addresses-attribute --allocation-ids "$ALLOC" --attribute domain-name \
    --query 'Addresses[0].PtrRecord' --output text)"
  [ "$PTR" = "$HELO." ] && { echo "$IP now points at $HELO"; exit 0; }
  sleep 10
done
echo "still pending; check with: aws ec2 describe-addresses-attribute --allocation-ids $ALLOC --attribute domain-name" >&2

# The phone Worker (`apps/phone`)

`phone.wrenautomation.com`: the SMS inbox PWA and the Telnyx webhook door. It holds
nothing; texts live in Postgres behind Restate. Sign-in is Wren's shared one
(`deploy/portal.md`): operators only.

## Token

`wren-workers`, minted 2026-09-28 by autobrowse (deterministic flow, no hands):

    cd ../autobrowse && pnpm -s autobrowse cloudflare-token wren-workers \
      --env WREN_CLOUDFLARE_WORKERS_TOKEN \
      --perm "Account:Workers Scripts:Edit" "Account:Workers KV Storage:Edit" \
             "Account:D1:Edit" "Account:Account Settings:Read" \
             "Zone:Workers Routes:Edit" "Zone:DNS:Edit" "Zone:Zone:Read"

It lands in autobrowse's env store (SSM), then in `deploy/prod.env` as
`CLOUDFLARE_API_TOKEN` and the `production` GitHub environment. Rerun with
`--force` to mint a new one.

## Deploy

CI deploys it on every green push to main (`deploy.yml`). Done once, 2026-09-28:
the custom domain and the secrets below. Since 2026-10-01 its own passkeys are gone:
the KV `wren-phone-creds`, the `SESSION_SECRET` / `SETUP_TOKEN` secrets and their
`WREN_PHONE_*` lines in `deploy/prod.env` are unused and can be deleted.

By hand, from `apps/phone/`:

    export CLOUDFLARE_ACCOUNT_ID="$WREN_CLOUDFLARE_ACCOUNT_ID"
    printf %s "https://$RESTATE_HOST:8080/" | npx wrangler secret put RESTATE_INGRESS_URL
    printf %s "$RESTATE_AUTH_TOKEN" | npx wrangler secret put RESTATE_AUTH_TOKEN
    # Telnyx portal → Account → Public Key. Until set, every webhook gets 503.
    printf %s "$TELNYX_PUBLIC_KEY" | npx wrangler secret put TELNYX_PUBLIC_KEY
    # The secret Wren's cal.com webhook signs with. Until set, /webhooks/calcom gets 503.
    printf %s "$CALCOM_WEBHOOK_SECRET" | npx wrangler secret put CALCOM_WEBHOOK_SECRET
    # Clients' cal.com secrets, one JSON object {"<client>": "<secret>"}. A client not in it gets 404.
    printf %s "$CALCOM_WEBHOOK_SECRETS" | npx wrangler secret put CALCOM_WEBHOOK_SECRETS
    npx wrangler deploy

The worker (Lambda) must already serve `SmsDesk` and `SmsEvents`, and migration
`0013_sms_channel` must be applied, or the app shows errors from Restate.

## Add a device

Open `https://phone.wrenautomation.com` on the device and tap "Sign in": Wren's
sign-in, as an operator (`wren operators add`). Then "Add a passkey on this device"
so the next sign-in is Face ID / fingerprint alone, and "Add to Home Screen" (Safari
share sheet on iPhone, Chrome menu on the Seeker). The sign-in lasts as long as the
auth session; the app fetches a fresh 15-minute token itself.

## Telnyx

Messaging profile → webhook URL `https://phone.wrenautomation.com/webhooks/telnyx`,
API v2. Put the profile id in `WREN_TELNYX_MESSAGING_PROFILE_ID` and the 10DLC
campaign id in `WREN_TELNYX_CAMPAIGN_ID`.

A client with `sms.texts`: its own messaging profile in Wren's account (the id in
`clients.accounts.telnyx`), webhook URL `https://phone.wrenautomation.com/webhooks/telnyx/<client>`.
Events go to `SmsEvents/ingestFor`, into its database.

## cal.com

A second webhook on Wren's cal.com (the lander's stays): `https://phone.wrenautomation.com/webhooks/calcom`,
BOOKING_CREATED / RESCHEDULED / CANCELLED, signed with `CALCOM_WEBHOOK_SECRET`. Made 2026-10-04
through cal.com's API with `WREN_CALCOM_API_KEY`. Each booking goes to `CallBookings/ingest`
(designs/2026-10-04-booking-webhook.md). Catch up with `wren email bookings sync [--since]`.

A client's cal.com: webhook `https://phone.wrenautomation.com/webhooks/calcom/<client>`, same
triggers, signed with its own secret in `CALCOM_WEBHOOK_SECRETS`. Each booking goes to
`CallBookings/ingestFor`, into its database (designs/2026-10-04-outbound-per-client.md).

## Check

    curl -s -X POST https://phone.wrenautomation.com/api/threads   # {"error":"sign in"}
    curl -s -X POST https://phone.wrenautomation.com/webhooks/telnyx -d '{}'   # 401 once the key is set

Local: `npx wrangler dev` with `.dev.vars` (RESTATE_INGRESS_URL). The app only
signs in on a `phone.` host, so locally every call is 401. Tests: `pnpm --filter @wren/phone test:unit`.

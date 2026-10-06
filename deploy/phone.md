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

## Credential links

`autobrowse creds link <site>` mints a one-time link to a stored login
(designs/2026-10-06-credential-links.md). Ciphertext lives in the KV `wren-phone-cred-links`
(binding `CRED_LINKS`, made 2026-10-06 with `npx wrangler kv namespace create`, id in
`wrangler.toml`), 10 minutes each. The Mac signs each mint with `CRED_LINK_SECRET`; the same
value is in `deploy/prod.env`, autobrowse's env store and the Worker. Made 2026-10-06, from the
repo root, the value never printed:

    node scripts/secrets.mjs run deploy/prod.env -- sh -c '
      S=$(openssl rand -hex 32); export S
      node scripts/secrets.mjs set CRED_LINK_SECRET=S
      printf %s "$S" | (cd ../autobrowse && env -i HOME="$HOME" PATH="$PATH" pnpm -s autobrowse env set CRED_LINK_SECRET)
      cd apps/phone && printf %s "$S" | CLOUDFLARE_ACCOUNT_ID=$WREN_CLOUDFLARE_ACCOUNT_ID npx wrangler secret put CRED_LINK_SECRET'

Rotate: run it again. Until set, `POST /links` gets 503.

## Add a device

Open `https://phone.wrenautomation.com` on the device and tap "Sign in": Wren's
sign-in, as an operator (`wren team add`). Then "Add a passkey on this device"
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

## Calendar

`/calendar/<handler>` (`slots`, `book`, `booking`, `reschedule`, `cancel`, POST only) is the lander's
door to our own booking calendar (designs/2026-10-06-calendar.md). No sign-in: `Calendar` checks the
lander's signature (`EXPORT_TOKEN`) or the call's signed link. No secret of its own here.

## Gmail push

Made 2026-10-04 in the service account's project (`wrenautomation`) with gcloud as
william@ (`cd ../autobrowse && pnpm -s autobrowse gcloud-login` when it lapses):
topic `gmail-push`, publisher `gmail-api-push@system.gserviceaccount.com` (the org's
domain-restricted sharing was lifted on the project for that one binding, then put
back), and a push subscription to the Worker:

    T=$(openssl rand -hex 24)
    printf %s "$T" | npx wrangler secret put GMAIL_PUSH_TOKEN
    gcloud pubsub subscriptions create gmail-push-phone --project wrenautomation \
      --topic gmail-push --push-endpoint "https://phone.wrenautomation.com/webhooks/gmail?token=$T" \
      --ack-deadline 30 --message-retention-duration 1d --expiration-period never

Rotate: the same two steps, `subscriptions update ... --push-endpoint`. Each
`InboxScheduler` renews its own watch (designs/2026-10-04-webhooks-serverless-round-2.md).

## Check

    curl -s -X POST https://phone.wrenautomation.com/api/threads   # {"error":"sign in"}
    curl -s -X POST https://phone.wrenautomation.com/webhooks/telnyx -d '{}'   # 401 once the key is set
    curl -s -X POST https://phone.wrenautomation.com/links -d '{}'             # 401: unsigned
    curl -s -X POST https://phone.wrenautomation.com/calendar/slots -d '{}'    # open times

Local: `npx wrangler dev` with `.dev.vars` (RESTATE_INGRESS_URL). The app only
signs in on a `phone.` host, so locally every call is 401. Tests: `pnpm --filter @wren/phone test:unit`.

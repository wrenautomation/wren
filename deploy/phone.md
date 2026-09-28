# The phone Worker (`apps/phone`)

`phone.wrenautomation.com`: the SMS inbox PWA and the Telnyx webhook door. It holds
passkeys only; texts live in Postgres behind Restate.

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

CI deploys it on every green push to main (`deploy.yml`, last step). Done once,
2026-09-28: KV `wren-phone-creds` (id in `wrangler.toml`), the custom domain, and
the secrets below. `SESSION_SECRET` and `SETUP_TOKEN` are kept in `deploy/prod.env`
as `WREN_PHONE_SESSION_SECRET` / `WREN_PHONE_SETUP_TOKEN`.

By hand, from `apps/phone/`:

    export CLOUDFLARE_ACCOUNT_ID="$WREN_CLOUDFLARE_ACCOUNT_ID"
    printf %s "$WREN_PHONE_SESSION_SECRET" | npx wrangler secret put SESSION_SECRET
    printf %s "$WREN_PHONE_SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN
    printf %s "https://$RESTATE_HOST:8080/" | npx wrangler secret put RESTATE_INGRESS_URL
    printf %s "$RESTATE_AUTH_TOKEN" | npx wrangler secret put RESTATE_AUTH_TOKEN
    # Telnyx portal → Account → Public Key. Until set, every webhook gets 503.
    printf %s "$TELNYX_PUBLIC_KEY" | npx wrangler secret put TELNYX_PUBLIC_KEY
    npx wrangler deploy

The worker (Lambda) must already serve `SmsDesk` and `SmsEvents`, and migration
`0013_sms_channel` must be applied, or the app shows errors from Restate.

## Add a device

Open `https://phone.wrenautomation.com/?setup=<SETUP_TOKEN>` on the device, tap
"Add this device", confirm with Face ID / fingerprint / Touch ID. Then "Add to Home
Screen" (Safari share sheet on iPhone, Chrome menu on the Seeker). After that, sign-in
is the passkey alone. Rotate `SETUP_TOKEN` when all devices are in.

## Telnyx

Messaging profile → webhook URL `https://phone.wrenautomation.com/webhooks/telnyx`,
API v2. Put the profile id in `WREN_TELNYX_MESSAGING_PROFILE_ID`.

## Check

    curl -s -X POST https://phone.wrenautomation.com/api/threads   # {"error":"sign in"}
    curl -s -X POST https://phone.wrenautomation.com/webhooks/telnyx -d '{}'   # 401 once the key is set

Local: `npx wrangler dev` with `.dev.vars` (SESSION_SECRET, SETUP_TOKEN,
RESTATE_INGRESS_URL). Tests: `pnpm --filter @wren/phone test:unit`.

# The phone Worker (`apps/phone`)

`phone.wrenautomation.com`: the SMS inbox PWA and the Telnyx webhook door. It holds
passkeys only; texts live in Postgres behind Restate.

## Token

`CLOUDFLARE_API_TOKEN` needs: Workers Scripts Edit, Workers KV Storage Edit, Workers
Routes Edit (zone), DNS Edit (zone), Zone Read. The token in `deploy/prod.env` today
lacks KV and D1 (Authentication error 10000).

## Deploy

From `apps/phone/`:

    export CLOUDFLARE_ACCOUNT_ID="$WREN_CLOUDFLARE_ACCOUNT_ID"
    npx wrangler kv namespace create wren-phone-creds    # id -> wrangler.toml

    rand() { node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"; }
    rand | npx wrangler secret put SESSION_SECRET
    rand | tee /dev/stderr | npx wrangler secret put SETUP_TOKEN    # keep it: it adds devices
    printf %s "$WREN_RESTATE_INGRESS_URL" | npx wrangler secret put RESTATE_INGRESS_URL
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

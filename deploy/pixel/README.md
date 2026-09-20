# The open-tracking pixel host

A Cloudflare Worker on `t.wrenautomation.com` that serves a 1×1 GIF and
records the fetch in D1. `OpensScheduler/fleet` pulls those rows into
Postgres, where `wren email opens` reads them beside the reply numbers.

**It is off by default** (`WREN_OPEN_TRACKING=false`). Standing this
up does not start tracking anything; see "Turning it on" below.

## Why a subdomain of the brand domain

Filters score every domain a message references, not just the sender's.
`wrenautomation.com` never sends cold mail, so a
tracker under it cannot contaminate the five sending domains; and it
carries an actual website, which a naked tracking domain would not.

## Deploy

Cloudflare's free tier covers this many times over (100k worker requests
and 5M D1 row reads a day; the fleet's ceiling is ~300 sends a day).

Authenticated by API token, not `wrangler login` — the login is an
interactive browser flow, and a token lets the deploy run from a script
unattended. `deploy/prod.env` (gitignored) carries it as
`CLOUDFLARE_WORKERS_EDIT_TOKEN`; wrangler reads `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`, so the account id stays out of this
repo — `wrangler.toml` deliberately does not name it.

The token needs, beyond the "Edit Cloudflare Workers" template:

| Permission | For |
|---|---|
| Account → Workers Scripts → Edit | the worker itself |
| Account → D1 → Edit | creating and writing the database |
| Zone → Workers Routes → Edit | binding `t.wrenautomation.com/*` |
| Zone → DNS → Edit | the hostname record |
| Zone → Zone → Read | resolving the zone by name |

Then, from `deploy/pixel/`:

    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_WORKERS_EDIT_TOKEN"

    npx wrangler d1 create wren-pixel   # prints database_id -> wrangler.toml
    npx wrangler d1 execute wren-pixel --remote --file=schema.sql

    # The shared secret the /export route requires. Generate it with
    #   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
    # and put the SAME value in deploy/prod.env as WREN_PIXEL_EXPORT_TOKEN.
    # `secret put` reads stdin, so it needs no prompt:
    printf %s "$WREN_PIXEL_EXPORT_TOKEN" | npx wrangler secret put EXPORT_TOKEN

    npx wrangler deploy

DNS: the route needs `t.wrenautomation.com` to exist and be proxied
(orange cloud). `wrangler deploy` creates the record when the zone is on
the same account; if it does not, add an `AAAA t -> 100::` proxied
record, the conventional placeholder for a worker-only hostname.

Verify:

    curl -sI https://t.wrenautomation.com/p/testtokentesttoken.gif   # 200 image/gif
    curl -s -H "Authorization: Bearer $TOKEN" \
      "https://t.wrenautomation.com/export?since=0"                  # {"hits":[...]}

## Turning it on

1. `WREN_PIXEL_BASE_URL=https://t.wrenautomation.com`
2. `WREN_PIXEL_EXPORT_TOKEN=<the secret above>`
3. `WREN_OPEN_TRACKING=true`

All three in `deploy/prod.env`, pushed with `deploy/scripts/push-secrets.sh`; the worker
reads them at cold start (`docs/restate-operations.md` → Changing env vars).

Only drafts composed **after** the flag is on carry a token, and only
tokened messages carry a pixel: an approved draft never changes shape
between approval and send. So the flag takes effect at the next compose pass,
and `wren email opens` counts only messages that actually carried one.

## What is stored

Token, timestamp, user agent. No IP, no country, no other headers — a
recipient's network is not ours to keep, and the timing plus the agent is
all the machine-open heuristic uses.

An unknown token gets the same 200 and the same GIF as a real one. The
URL space must not answer questions.

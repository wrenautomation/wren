# Custom domains

Living doc. Started 2026-10-06. William: "go on everything". On custom domains: "if that's needed then do it". The end-goal row: client CNAMEs `app.client.com` to us; Cloudflare for SaaS issues and renews the cert.

## Answer first

- A client points `portal.client.com` (any name) at `customers.wrenautomation.com` with a CNAME. Cloudflare for SaaS on the `wrenautomation.com` zone issues and renews the cert. We write no proxy or cert code.
- The portal Worker serves the custom host. It looks up which client the host belongs to and pins every request to that client. The existing access guard still checks the login is a member there.
- Sign-in stays on `auth.wrenautomation.com`. The client's host never relies on a third-party cookie. A one-time code carries the session over, and the Worker keeps it in a first-party cookie on the client's host.
- Account > Domain shows the CNAME and TXT records to set and the live status from Cloudflare's API.
- $0: the first 100 hostnames are free. If turning it on asks for a card or a charge, we stop and ask William.

## Sign-in on a client's host

Every piece is Better Auth's (open source). We add one endpoint, which checks the target domain and returns a redirect.

1. The app on `portal.client.com` asks its own Worker for a token: `GET /__auth/token`. No session cookie means a 401, and the app sends the browser to `auth.wrenautomation.com/?next=https://portal.client.com/__auth/back?next=<path>`.
2. Signed in there (first-party), the sign-in page sends any `next` that isn't one of our hosts to `/api/auth/handoff?to=<next>`. The handoff endpoint (our plugin) needs a session and checks that `to` is `https://<host>/__auth/back` on an active client domain. It then issues a one-time token (Better Auth `one-time-token`: single use, 1 minute, stored hashed) and redirects to `to&ott=<token>`. Anything else redirects to the portal.
3. `/__auth/back` on the client's host: the Worker redeems the code server to server (`one-time-token/verify`, no cookie set there) and gets the session token back. The Worker stores it in `__Host-wren_session` (HttpOnly, Secure, SameSite=Lax, 30 days), then redirects to `next`, same-origin paths only.
4. `/__auth/token`: the Worker asks the sign-in Lambda for the 15-minute JWT with the session as a bearer (Better Auth `bearer`), sending the edge secret and the visitor's IP like the auth Worker does. The cookie's age is refreshed each time. A 401 clears the cookie.
5. `/__auth/out`: the Worker signs the session out at the Lambda, clears the cookie, and sends the browser to `auth.wrenautomation.com/?out=1`.

The session is the renewal credential. Better Auth handles expiry (30 days, sliding daily) and revocation. A password reset revokes it. JavaScript never sees it. The JWT is checked by jose against the published keys, as on `app.`.

## Routing

- Fallback origin: `customers.wrenautomation.com AAAA 100::`, proxied. Clients CNAME to it.
- A `*/*` route on the zone sends custom hostnames to `wren-portal`. Our own hosts are kept out three ways:
  - Worker custom domains (`app`, `auth`, `demo`, `phone`) beat routes. `t` and `www` have more specific routes.
  - No-Worker routes for `wrenautomation.com/*` (the lander on Pages) and `desk.wrenautomation.com/*` (the desk tunnel), made by `deploy/portal-domains.mjs`.
  - The Worker passes any other `*.wrenautomation.com` host it doesn't serve straight to its origin (`fetch(req)`), so a host added later still works.
- Wrangler replaces a script's routes on each deploy, so the `*/*` route lives in `wrangler.toml`. Per-hostname routes made through the API would be wiped.

## Data

- `client_domains` in the main database: `hostname` (unique, lowercased), `client_id`, `cf_id`, `status`, `ssl_status`, `records` (the CNAME and TXT values to show), `checked_at`, `created_at`.
- Restate `Domains`:
  - `resolve {host}` returns the client, or null. It is public; the Worker caches answers for 5 minutes.
  - `list`, `add`, `remove` and `check` are portal routes behind the guard. Only a client's owner, or Wren's admins, may add or remove.
- Cloudflare calls (`POST/GET/DELETE /zones/:zone/custom_hostnames`) use `WREN_CLOUDFLARE_SAAS_TOKEN`, scoped to the zone with "SSL and Certificates: Edit" only.

## Guards

- A hostname must be a real public name. It can't be ours (`*.wrenautomation.com`), an apex we can't CNAME, or already held by another client.
- One domain per client to start.
- Never touch MX, SPF, DKIM or DMARC on any domain. The page shows only a CNAME and TXT records.
- The live test is `portal.wrenautomationreviews.com` (our domain, no mail on it), with a DNS-only CNAME.

## Decision log

- 2026-10-06: William approved, relayed by the wren UI session. Built without a second yes.
- 2026-10-06: A handoff instead of CORS with credentials. On a client's host the sign-in cookie is third-party, and Safari and Firefox block it. A one-time code to a first-party cookie works in every browser, and Better Auth ships the parts.
- 2026-10-06: `*/*` plus exclusions and pass-through, since wrangler wipes routes it doesn't list. A separate SaaS zone would isolate it better, but it would need a second domain on the main brand.

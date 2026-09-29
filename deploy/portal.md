# The portal Worker (`apps/portal`)

One Worker, two hosts:

- `app.wrenautomation.com`: a client's own list. Cloudflare Access signs people in
  by email code; the Worker checks the Access token itself and passes the email.
- `demo.wrenautomation.com`: the demo client, no login, masked, cached 5 minutes
  at the edge.

`/api/<route>` goes to the `ReactivationPortal` service on the worker (Lambda)
through Restate's ingress. The Worker always sets the viewer; the browser's is
ignored. The rest is the React app in `web/`, built to `dist/`.

Who sees what: `wren clients set <id> --portal-email a@firm.com` (the list is the
only door). Emails in `OPERATOR_EMAILS` see every client.

## Deploy

CI deploys it on every green push to main (`deploy.yml`, last step). The step
sends these secrets with the version; an unset GitHub secret leaves the Worker's
value as it was:

| Worker secret | From (GitHub `production` secret) |
|---|---|
| `RESTATE_INGRESS_URL` | `https://$RESTATE_HOST:8080/` |
| `RESTATE_AUTH_TOKEN` | `RESTATE_AUTH_TOKEN` |
| `ACCESS_TEAM_DOMAIN` | `PORTAL_ACCESS_TEAM_DOMAIN`, e.g. `wren.cloudflareaccess.com` |
| `ACCESS_AUD` | `PORTAL_ACCESS_AUD` |
| `OPERATOR_EMAILS` | `PORTAL_OPERATOR_EMAILS`, comma separated |

Until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, `app.` answers 503 "Sign-in
isn't set up yet." The demo works without them.

## Access (once)

1. Zero Trust dashboard. Pick the team name; the team domain is
   `<team>.cloudflareaccess.com`.
2. Settings → Authentication: add "One-time PIN".
3. Access → Applications → Add → Self-hosted. Domain `app.wrenautomation.com`,
   session 30 days. Policy: Allow, include Everyone, login method One-time PIN.
   `clients.portal_emails` decides what a login sees; a stranger who signs in sees
   "this login has no client". Each sign-in takes a seat (50 free).
4. Copy the application's Audience (AUD) tag.
5. `gh secret set PORTAL_ACCESS_TEAM_DOMAIN --env production`, same for
   `PORTAL_ACCESS_AUD`, then rerun `deploy`.

No Access application on `demo.`.

## Demo

    wren clients add demo --name "<agency>" --demo
    wren --client demo crm seed-demo --agency https://<agency site>
    wren --client demo crm run

The agency's name stays in the database; the portal shows "Sample recruiting firm".

## Local

    pnpm --filter @wren/portal preview           # localhost:8788, as an operator
    pnpm --filter @wren/portal preview --demo    # as the demo host

It serves `dist/` and runs the same handlers in-process against `WREN_DATABASE_URL`
and the client databases. Tests: `pnpm --filter @wren/portal test:unit` (the Worker)
and `packages/reactivation/test/integration/portal.test.ts` (the handlers and the mask).

## Check

    curl -s -X POST https://demo.wrenautomation.com/api/me -H 'content-type: application/json' -d '{}'
    curl -s -X POST https://app.wrenautomation.com/api/me -H 'content-type: application/json' -d '{}'   # 401 "Sign in." once Access is set

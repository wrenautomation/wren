# The portal Worker (`apps/portal`) and its sign-in (`apps/auth`)

Three hosts:

- `app.wrenautomation.com`: a client's own list. The app gets a 15-minute token
  from our sign-in and sends it as a bearer; the Worker checks it
  (`@wren/auth/verify`) and passes the email and operator flag on.
- `auth.wrenautomation.com`: our sign-in (Better Auth). Emailed code or link,
  Google, Microsoft, password. Invite-only. The auth Worker serves the sign-in
  pages and forwards `/api/auth/*` to the `wren-prod-auth` Lambda with the edge
  secret; the Lambda refuses anything without it.
- `demo.wrenautomation.com`: the demo client, no login, masked, cached 5 minutes
  at the edge.

`/api/<route>` on app. goes to the `ReactivationPortal` service on the worker
(Lambda) through Restate's ingress. The Worker always sets the viewer; the
browser's is ignored. The rest is the React app in `web/`, built to `dist/`.

Reads run in a read-only transaction. The only writes are approve, skip and
"meeting booked"; the demo refuses them at the edge and in the service. A
booking is billed, so only the login that marked it, or Wren, takes it back.

## Who gets in

    wren clients members add <id> a@firm.com [--role owner]   # sees that client
    wren clients members remove <id> a@firm.com
    wren operators add a@wrenautomation.com                   # sees every client

Only these emails get an account; anyone else is sent nothing. Against prod,
point the CLI at prod's `WREN_DATABASE_URL`. Operator changes land on the next
token (within 15 minutes).

Sign-in mail goes through Gmail as `portal@wrenautomation.com` (a send-as alias
on william@) with the service account.

## Deploy

CI deploys all three on every green push to main (`deploy.yml`): it migrates,
updates the auth Lambda's code, then deploys the auth and portal Workers.
Terraform (`deploy/terraform/auth.tf`) owns the Lambda, its function URL and
role. Secrets:

| Where | Name | From |
|---|---|---|
| SSM `/wren/prod/env` | `WREN_AUTH_SECRET`, `WREN_AUTH_EDGE_SECRET`, `WREN_AUTH_GOOGLE_CLIENT_ID/_SECRET`, `WREN_AUTH_MICROSOFT_CLIENT_ID/_SECRET` | `deploy/prod.env` via `push-secrets.sh` |
| auth Worker | `LAMBDA_URL`, `EDGE_SECRET` | GitHub `AUTH_LAMBDA_URL`, `AUTH_EDGE_SECRET` |
| portal Worker | `RESTATE_INGRESS_URL`, `RESTATE_AUTH_TOKEN` | `https://$RESTATE_HOST:8080/`, `RESTATE_AUTH_TOKEN` |

`EDGE_SECRET` and `WREN_AUTH_EDGE_SECRET` must match. To rotate: new value in
prod.env, `push-secrets.sh`, `gh secret set AUTH_EDGE_SECRET --env production`,
rerun deploy.

OAuth redirect URIs: `https://auth.wrenautomation.com/api/auth/callback/google`
(GCP project `wren-sign-in`) and `.../callback/microsoft` (Entra app "Wren sign-in").

## Demo

    wren clients add demo --name "<agency>" --demo
    wren --client demo crm seed-demo --agency https://<agency site>
    wren --client demo crm run

The agency's name stays in the database; the portal shows "Sample recruiting firm".

## Local

    pnpm --filter @wren/portal preview           # localhost:8788, as an operator
    pnpm --filter @wren/portal preview --demo    # as the demo host

It serves `dist/` and runs the same handlers in-process against `WREN_DATABASE_URL`
and the client databases, no sign-in. Tests: `pnpm --filter @wren/portal test:unit`
(the Worker), `pnpm --filter @wren/auth-app test:unit` (the auth Worker and Lambda
glue), `packages/auth/test/integration` (sign-in end to end on Postgres) and
`packages/reactivation/test/integration/portal.test.ts` (the handlers and the mask).

## Check

    curl -s https://auth.wrenautomation.com/api/auth/ok                  # {"ok":true}
    curl -s https://auth.wrenautomation.com/api/auth/jwks                # one Ed25519 key
    curl -s -X POST https://app.wrenautomation.com/api/me -d '{}'        # 401
    curl -s -X POST https://demo.wrenautomation.com/api/me -H 'content-type: application/json' -d '{}'

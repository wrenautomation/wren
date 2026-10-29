---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-29 @ ef481a93
entity: packages/auth/src/index.ts:109
covers: ["@wren/auth", "@wren/auth-app"]
stamp: 239b7ff7
---

# sign-in

Wren's one sign-in for every app, at auth.wrenautomation.com (designs/2026-09-30-client-delivery-portal.md, A1–A9): `makeAuth` is Better Auth over our Postgres, tables in schema `auth`. Product word: sign-in. Package `@wren/auth`; the host is app `@wren/auth-app` (`apps/auth`).

## Why this shape

Invite-only: an account is made only when `allowed(email)` says yes, and the registry decides that (`mayHaveAccount`, `packages/core/src/clients/index.ts:377`), never this package. One account per verified email across every method (email code, passkey). Apps never call Better Auth: each reads a short-lived EdDSA token (15 min, audience `wren`) and checks it against the published keys with jose (`verifyToken`, `packages/auth/src/verify.ts:53`), so a Worker or a Lambda checks a user with no database call. On a client's own host our cookie is third-party, so a handoff carries the sign-in there: a one-time token, good for a minute and once, sent only to that host's `/__auth/back`, and only for that client's own members (`mayHandOff`, `packages/core/src/clients/domains.ts:167`; designs/2026-10-06-custom-domains.md). The client controls that host's DNS, so Wren's team never hands off.

## Shape

- tables in schema `auth`: `user`, `session`, `account`, `verification`, `jwks`, `rate_limit`, `passkey` (`packages/auth/src/schema.ts:9`)
- plugins: email OTP (10 min), Have I Been Pwned, passkey, jwt, one-time token (handoff only, minted server side) (`index.ts:177`)
- session 30 days, refreshed daily (`index.ts:128`)
- handoff: `BACK_PATH`, `handoffTarget` (https, the landing path, no login or port) (`packages/auth/src/handoff.ts`)
- `@wren/auth-app`: the edge Worker (`apps/auth/src/worker.ts`) serves the sign-in pages (`apps/auth/web`) and forwards `/api/auth/*` to the sign-in Lambda (`apps/auth/lambda/index.ts`) with the edge secret and the caller's IP; only the app origins in `APPS` may read `/api/auth/token` cross-origin

Citations: `packages/auth/src/index.ts:109`, `packages/auth/src/verify.ts:53`, `apps/auth/src/worker.ts:1`

## Connected to

- **owned-by:** [[clients/client-member]] (who may have an account)
- **joins:** [[platform/access-token]] (a connector's token, not a person's sign-in)
- **looks-like-but-is-not:** the portal operator sign-in on the box; a client's API keys

## If you change this

- **Hits:** every app that checks a token (`@wren/auth/verify`: portal Worker, apps on client hosts), the Lambda's `allowed` and `handoff` wiring, `apps/auth/web`
- **Does not hit:** the registry's rules (core decides who may sign in)

## Surfaces

| Surface | Role |
|---|---|
| auth.wrenautomation.com | sign-in pages, writes `auth.*` |
| app.wrenautomation.com and client hosts | read the token |

## See

- Source: `packages/auth/src/`, `apps/auth/`
- Design: `designs/2026-09-30-client-delivery-portal.md`, `designs/2026-10-06-custom-domains.md`

---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-05 @ f1187d6
entity: packages/core/src/clients/schema.ts:62
---

# client-member

Who may sign in to Wren and what they may do: a `client_members` row (an email on one client: owner, member or viewer) or an `operators` row (Wren's own people: admin, operator or viewer, on every client or a list).

## Why this shape

Sign-in is invite-only. Our sign-in (Better Auth at auth.wrenautomation.com) asks `mayHaveAccount` before it makes an account, so a stranger gets no mail and no row. A passkey is added only once signed in, so it never makes an account either. One table per question: membership says which clients, the operator list says all of them or `clients`. Roles grant fixed permissions (`can` in `packages/core/src/access.ts:55`, the matrix at `:29`); the row is read fresh per portal call (`whoIs`, `packages/core/src/portal.ts:72`), not trusted from the token, so a removal or demotion takes effect at once.

## Shape

- `client_members` (`packages/core/src/clients/schema.ts:62`): `client_id` + `email` (key), `role` owner | member | viewer, `invited_by`, `invited_at`, `last_seen_at`; deleting the client deletes its members
- `operators` (`:91`): `email`, `role` admin | operator | viewer (default admin), `clients` (null = all; `wren` = Wren's own apps), `added_at`
- `addMember` / `removeMember` / `listMembers`, `addOperator` / `isOperator`, `mayHaveAccount`, `touchMember` (`packages/core/src/clients/index.ts:146`, `:163`, `:175`, `:188`, `:210`, `:219`, `:229`); emails lowercased and trimmed (`:143`)
- `clientsFor` (`packages/core/src/portal.ts:185`) lists a scoped operator's clients only
- Every portal route declares a need (`packages/core/src/access.ts:75`); `guard` (`packages/core/src/portal.ts:105`) checks it before the handler runs and hands the handler the fresh role as `viewer.team`. `teamCan` (`:175`) checks a second need inside a handler (an effect handler, a Money record)
- The sign-in: `makeAuth` (`packages/auth/src/index.ts:91`), schema `auth` in the main database; the Lambda (`apps/auth/lambda/index.ts`) behind the auth Worker (`apps/auth/src/worker.ts`)
- Apps check the token with `verifyToken` (`packages/auth/src/verify.ts:86`): EdDSA, iss, aud `wren`, exp

Citations: `packages/core/src/clients/schema.ts:62`, `packages/core/src/clients/index.ts:188`, `packages/core/src/access.ts:55`, `packages/core/src/portal.ts:72`, `packages/auth/src/index.ts:91`, `packages/auth/src/verify.ts:86`

## Connected to

- **owned-by:** [[clients/client]] (members go with the client)
- **joins:** the portal's `clientsFor` (`packages/core/src/portal.ts:185`), which lists a member's clients
- **looks-like-but-is-not:** [[clients/client-login]] (a Postgres login per client database, not a person)

## If you change this

- **Hits:** the sign-in's account gate and token claims, the portal's client list, `wren clients members` and `wren operators`
- **Does not hit:** client databases (all of this is in main)

## Surfaces

| Surface | Role |
|---|---|
| `wren clients members add\|remove\|list`, `wren operators add\|remove\|list` | writes |
| auth.wrenautomation.com, app.wrenautomation.com | reads |
| portal Settings (`delivery/people`, `invite`, `remove`; `packages/delivery/src/service.ts`) | an owner or Wren invites and removes; the last owner stays |
| `ConsolePortal.setLook` (need `manage`) | an owner sets their own client's look, an admin any client's |

## See

- Design: `designs/2026-09-30-client-delivery-portal.md`, `designs/2026-10-05-access.md`
- Deploy: `deploy/portal.md`

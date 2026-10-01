---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-01 @ 378623c
entity: packages/core/src/clients/schema.ts:53
---

# client-member

Who may sign in to Wren and what they see: a `client_members` row (an email on one client, owner or member) or an `operators` row (Wren's own people, every client).

## Why this shape

Sign-in is invite-only. Our sign-in (Better Auth at auth.wrenautomation.com) asks `mayHaveAccount` before it makes an account, so a stranger gets no mail and no row. One table per question: membership says which clients, the operator list says all of them. An operator flag is read fresh into each 15-minute token, so removing one takes effect without a session wipe.

## Shape

- `client_members` (`packages/core/src/clients/schema.ts:53`): `client_id` + `email` (key), `role` owner | member, `invited_by`, `invited_at`, `last_seen_at`; deleting the client deletes its members
- `operators` (`:77`): `email`, `added_at`
- `addMember` / `removeMember` / `listMembers`, `addOperator` / `isOperator`, `mayHaveAccount`, `touchMember` (`packages/core/src/clients/index.ts:120`, `:153`, `:165`, `:171`, `:181`); emails lowercased and trimmed (`:117`)
- The sign-in: `makeAuth` (`packages/auth/src/index.ts:85`), schema `auth` in the main database; the Lambda (`apps/auth/lambda/index.ts`) behind the auth Worker (`apps/auth/src/worker.ts`)
- Apps check the token with `verifyToken` (`packages/auth/src/verify.ts:82`): EdDSA, iss, aud `wren`, exp

Citations: `packages/core/src/clients/schema.ts:53`, `packages/core/src/clients/index.ts:171`, `packages/auth/src/index.ts:85`, `packages/auth/src/verify.ts:82`

## Connected to

- **owned-by:** [[clients/client]] (members go with the client)
- **joins:** the portal's `clientsFor` (`packages/core/src/portal.ts:36`), which lists a member's clients
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

## See

- Design: `designs/2026-09-30-client-delivery-portal.md`
- Deploy: `deploy/portal.md`

---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-05 @ 8432ec5
entity: packages/core/src/clients/schema.ts:62
---

# client-member

Who may sign in to Wren and what they may do: a `client_members` row (an email on one client: owner, member or viewer) or an `operators` row (Wren's own people: admin, operator or viewer, on every client or a list).

## Why this shape

Sign-in is invite-only. Our sign-in (Better Auth at auth.wrenautomation.com) asks `mayHaveAccount` before it makes an account, so a stranger gets no mail and no row. A passkey is added only once signed in, so it never makes an account either. One table per question: membership says which clients, the operator list says all of them or `clients`. Roles grant fixed permissions (`can` in `packages/core/src/access.ts:55`, the matrix at `:29`); the row is read fresh per portal call (`whoIs`, `packages/core/src/portal.ts:74`), not trusted from the token, so a removal or demotion takes effect at once.

## Shape

- `client_members` (`packages/core/src/clients/schema.ts:62`): `client_id` + `email` (key), `role` owner | member | viewer, `invited_by`, `invited_at`, `last_seen_at`; deleting the client deletes its members
- `operators` (`:91`): `email`, `role` admin | operator | viewer (default admin), `clients` (null = all; `wren` = Wren's own apps), `added_at`
- `addMember` / `removeMember` / `listMembers`, `addOperator` / `isOperator`, `mayHaveAccount`, `touchMember` (`packages/core/src/clients/index.ts:149`, `:166`, `:178`, `:191`, `:277`, `:286`, `:296`); emails lowercased and trimmed (`:146`)
- Team seats: `setTeamSeat` (`:214`, a field left out keeps its value), `removeTeamSeat` (`:240`), both refuse to drop the last admin (`keepAnAdmin`, `:249`). `endSessions` (`:266`) deletes the person's Better Auth sessions: on removal, a demotion or a narrower client list, for a team seat or a member (`delivery/remove`, a lower role on `delivery/invite`)
- The Team page: `console.team` (`:304`, need `team`), written by `ConsolePortal.teamSet` / `teamRemove` (`packages/core/src/console.ts:904`, `:915`, need `wren:team`)
- `clientsFor` (`packages/core/src/portal.ts:191`) lists a scoped operator's clients only
- Every portal route declares a need (`packages/core/src/access.ts:75`); `guard` (`packages/core/src/portal.ts:107`) checks it before the handler runs and hands the handler the fresh role as `viewer.team`. `teamCan` (`:181`) checks a second need inside a handler (an effect handler, a Money record, a client's invoices, who manages People)
- `portalMe` (`packages/core/src/portal.ts:258`) sends each client's `can` and `role`, and `team.wren` for Wren's apps. The web hides what a login lacks: an app or page's `requires.needs`, and each action's need, taken from its route by `permissionOf` (`apps/portal/src/services.ts:42`)
- The sign-in: `makeAuth` (`packages/auth/src/index.ts:91`), schema `auth` in the main database; the Lambda (`apps/auth/lambda/index.ts`) behind the auth Worker (`apps/auth/src/worker.ts`)
- Apps check the token with `verifyToken` (`packages/auth/src/verify.ts:86`): EdDSA, iss, aud `wren`, exp

Citations: `packages/core/src/clients/schema.ts:62`, `packages/core/src/clients/index.ts:214`, `packages/core/src/access.ts:55`, `packages/core/src/portal.ts:74`, `packages/auth/src/index.ts:91`, `packages/auth/src/verify.ts:86`

## Connected to

- **owned-by:** [[clients/client]] (members go with the client)
- **joins:** the portal's `clientsFor` (`packages/core/src/portal.ts:191`), which lists a member's clients
- **looks-like-but-is-not:** [[clients/client-login]] (a Postgres login per client database, not a person)

## If you change this

- **Hits:** the sign-in's account gate and token claims, the portal's client list, `wren clients members` and `wren team`
- **Does not hit:** client databases (all of this is in main)

## Surfaces

| Surface | Role |
|---|---|
| `wren clients members add\|remove\|list`, `wren team add\|set\|rm\|ls` | writes |
| auth.wrenautomation.com, app.wrenautomation.com | reads |
| portal Account → People (`delivery/people`, `invite`, `remove`; `packages/delivery/src/service.ts`) | an owner or an admin invites (owner, member or viewer) and removes; the last owner stays |
| Wren → Team (`console.team`) | an admin invites, changes role and clients, removes; the last admin stays |
| `ConsolePortal.setLook` (need `manage`) | an owner sets their own client's look, an admin any client's |

## See

- Design: `designs/2026-09-30-client-delivery-portal.md`, `designs/2026-10-05-access.md`
- Deploy: `deploy/portal.md`

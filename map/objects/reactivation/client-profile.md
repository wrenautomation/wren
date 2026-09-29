---
type: object
cluster: reactivation
universe: live
status: verified
verified: 2026-09-29 @ 23a6170
entity: packages/reactivation/src/schema.ts:164
---

# client-profile

Who the firm is and who its recruiters are: one `client_profile` row in the client's database. The composer writes as a recruiter; handoffs go to one.

## Why this shape

The profile is facts the client edits in the portal (firm, what they place, recruiters, default recruiter). Product settings (senders, stages, ramp, approval) live in the registry's `clients.products.reactivation`, parsed by `reactivationSettingsSchema` (`packages/reactivation/src/settings.ts:17`), because Wren sets those, not the client.

## Shape

- `client_profile` (`schema.ts:164`), one row
- Settings: `settings.ts:17`, `reactivationSettingsOf` (`:101`)

Citations: `packages/reactivation/src/schema.ts:164`, `packages/reactivation/src/settings.ts:17`

## Connected to

- **owned-by:** [[clients/client]]
- **joins:** [[reactivation/handoff]] (recruiter), compose (writes as)

## If you change this

- **Hits:** compose prompt and gate (`compose.ts`), `handoffRecruiter` (`handoff.ts:32`), portal profile page
- **Does not hit:** sending (senders are settings, not profile)

## Surfaces

| Surface | Role |
|---|---|
| portal | writes |
| `Reactivation/{client}` | reads |

## See

- Source: `packages/reactivation/src/profile.ts`

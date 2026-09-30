---
type: object
cluster: research
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/research/src/schema.ts:128
---

# discovery-attempt

One try at finding or proving a company's domain, with its outcome. Table `discovery_attempts`.

## Why this shape

Guessed hosts are mostly parked or dead. Recording every attempt (`DISCOVERY_OUTCOMES`, `packages/research/src/schema.ts:112`) lets the pool feeder skip companies already tried and lets the gate say why nothing was found.

## Shape

- `company_id`, `kind` (discover | verify), `outcome`, `import_id`, `attempted_at` (`:130`–`136`); index on company, kind, time (`:140`)

Citations: `packages/research/src/schema.ts:128`

## Connected to

- **owned-by:** [[leads/company]]
- **joins:** [[ledger/import]] (a discovery batch is an import)

## If you change this

- **Hits:** `packages/research/src/discovery/service.ts:96` and its selection queries; `packages/research/src/discovery/gate.ts`
- **Does not hit:** verifications (address verdicts are a different question)

## Surfaces

| Surface | Role |
|---|---|
| `Discovery.discover/verify` (driven by `PoolScheduler`) | write |

## See

- Source: `packages/research/src/discovery/service.ts`

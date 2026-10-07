---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ 85f81a2
entity: packages/core/src/setup.ts:1
---

# account setup (registry, facts, setup runs)

Every account an owner has (a number, a domain, an inbox, a property, a login) is a `client_accounts` row with named facts. A setup is a workflow of `kind: "setup"` on the spine that makes those facts true, one step each (designs/2026-10-07-setup-and-vendors.md).

## Why this shape

One engine: a setup walks the spine like any workflow, one subject per account and generation (`account:<id>:g<gen>`). The spine keeps one arrival per node and subject, so a step that checks again goes round its own self wire with a wait under a round subject (`#<n>`); `done` always leaves with the base subject. A lost fact starts the setup over as the next generation; old rounds see a stale generation and do nothing. Facts live on the account they describe, so each number and domain carries its own.

## Shape

- Tables, main only (`packages/core/src/setup-schema.ts`): `client_accounts` (`:46`, unique client+site+ref, nulls equal; null client is Wren), `account_facts` (`:81`, pk account+fact, state ok/waiting/lost), `setup_runs` (`:113`, unique account+setup; state checking/waiting_client/waiting_wren/done/stuck/lost; `gen`, `rounds`, `next_check_at`)
- `clients.setup_mode` (self | for_you) and `clients.buys_ok` (William's yes for buys done for a client)
- Code (`setup.ts`): `defineSetup` (`:71`), `setupWorkflow` (`:78`), `startSetup` (`:345`), `markStep` (`:398`), `factLost` (`:425`), `recheck` (`:461`), `setupStep` (`:533`, registered as `setup.step`), `dnsChecks` (`:160`), `factsHeld`/`factsLacking` (`:261`)
- Setups: `packages/core/src/setups.ts` (Search Console, Calendar, Meta), `packages/channel-sms/src/setups.ts` (texting 10DLC, number; `smsChecks`), `packages/channel-email/src/setups.ts` (domain, inbox; `emailChecks`). The worker lists them in `apps/worker/src/setups.ts`
- `SetupWatch/all` (`packages/core/src/setup-watch.ts`): hourly `recheck`, emits restarts; off until started
- A part's `requires.facts` names the facts it needs

## Connected to

- **owned-by:** [[platform/spine]] (runs it), [[platform/worker]] (registers `setup.step`, checks, `SetupWatch`)
- **joins:** [[platform/vendors]] (a setup's buys fold into managed billing, Open)
- **looks-like-but-is-not:** `clients.accounts` (the Shop's one link per site; the registry is the superset)

## If you change this

- **Hits:** setup subjects (a new format strands runs in flight), `EVENT_KINDS.account`, the worker's WORKFLOWS (`components.test.ts`)
- **Does not hit:** other workflows' events

## Surfaces

| Surface | Role |
|---|---|
| Accounts page (client and Wren's team) | reads |
| `setup.step` on the spine | writes facts and runs |
| SetupWatch | writes on recheck |

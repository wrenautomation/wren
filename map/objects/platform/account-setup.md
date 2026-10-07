---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ f23c6bb
entity: packages/core/src/setup.ts:1
---

# account setup (registry, facts, setup runs)

Every account an owner has (a number, a domain, an inbox, a property, a login) is a `client_accounts` row with named facts. A setup is a workflow of `kind: "setup"` on the spine that makes those facts true, one step each (designs/2026-10-07-setup-and-vendors.md).

## Why this shape

One engine: a setup walks the spine like any workflow, one subject per account and generation (`account:<id>:g<gen>`). The spine keeps one arrival per node and subject, so a step that checks again goes round its own self wire with a wait under a round subject (`#<n>`); `done` always leaves with the base subject. A lost fact starts the setup over as the next generation; old rounds see a stale generation and do nothing. Facts live on the account they describe, so each number and domain carries its own.

## Shape

- Tables, main only (`packages/core/src/setup-schema.ts`): `client_accounts` (`:46`, unique client+site+ref, nulls equal; null client is Wren), `account_facts` (`:81`, pk account+fact, state ok/waiting/lost), `setup_runs` (`:113`, unique account+setup; state checking/waiting_client/waiting_wren/done/stuck/lost; `gen`, `rounds`, `next_check_at`), `setup_alerts` (`:170`, unique `key` per change; kind lost/stuck/waiting/done/paused/resumed, `for` client/wren, `cleared_at`, `told_at`, `digest_at`)
- `clients.setup_mode` (self | for_you) and `clients.buys_ok` (William's yes for buys done for a client)
- Code (`setup.ts`): `defineSetup` (`:85`), `setupWorkflow` (`:92`), `startSetup` (`:406`), `markStep` (`:459`), `factLost` (`:518`), `recheck` (`:563`), `sweepStuck` (`:616`), `agentDone` (`:708`), `setupStep` (`:771`, registered as `setup.step`), `dnsChecks` (`:174`), `factsHeld`/`factsLacking` (`:275`)
- Setups: `packages/core/src/setups.ts` (Search Console, Calendar, Meta; their checks beside each vendor: `searchConsoleChecks` in `packages/channel-search/src/setups.ts`, `calendarChecks` in `packages/calendar/src/setups.ts`, `metaChecks` in `packages/channel-meta/src/setups.ts`, read through autobrowse `sites` without waking the box), `packages/channel-sms/src/setups.ts` (texting 10DLC, number; `smsChecks`), `packages/channel-email/src/setups.ts` (domain, inbox; `emailChecks`). The worker lists them in `apps/worker/src/setups.ts`
- Alerts (`packages/core/src/setup-alerts.ts`): every change writes one `setup_alerts` row by key (`setupAlert` `:118`); a fact moving ok/lost raises lost, paused and resumed (`factMoved` `:263`); `tellAlerts` (`:371`) pings the clients lane once per alert (never a client's own waiting step); `digestAlerts` (`:412`) once a day per owner. Routing: `who: client` self-serve is the client's, the rest Wren's. Read by `AccountsConsole.now` (Now on Wren's home and the client's Apps page, the Accounts badge), the Accounts timeline, and DeliveryWatch's client mail (people whose access reaches the Account app)
- Stuck: the round past a step's `within` sets `stuck` and alerts once; an `auto` step with a live check keeps checking. Steps without `every` are swept by `sweepStuck`
- Paused: only a lost fact pauses an installed part (`pausedParts` `:220`): "Paused: needs <step>" on canvas nodes, Shop rows (`ready: "paused"`), part and template pages, the install plan (`PlanPart.paused`) and Accounts. SearchWatch and PostmasterScheduler hold their pass (`partPaused` `:246`, `pausedPass` in `packages/core/src/restate/loop.ts:136`)
- Done for you: with `WREN_SETUP_AGENT`, a step's first round queues an `AgentJob` by ingress to `SetupAgent/run` (`packages/core/src/setup-agent.ts`), which calls autobrowse `do` in the account owner's autobrowse (`restateDo` with `owner`: `do` or `do_<client>`, 2 hour timeout) and answers through `agentDone`. A `buys` step never runs without `clients.buys_ok` (`wren clients set <id> --buys-ok yes`); Wren's own buys always wait. Off: the team does it
- `SetupWatch/all` (`packages/core/src/setup-watch.ts`): hourly `recheck`, `sweepStuck`, `tellAlerts`, `digestAlerts`; writes only setup runs, facts and alerts (`setup-alerts.test.ts` puts a write trigger on every other table); never queues the agent; off until started (`node scripts/ingress.mjs SetupWatch/all/start`)
- A part's `requires.facts` names the facts it needs; the Shop reads "Needs your account" (team and client) until each holds (`console.ts` `lacksFacts`, `factAccounts`); on the part page the account the fact sits on reads "Saved", not "Connected", until then (`Catalog.tsx` `tagOf`), and `kind: "setup"` workflows stay out of the Shop
- `AccountsConsole` (`packages/core/src/accounts-console.ts`, routes in `accounts-console-routes.ts`): `accounts`, `start`, `mark`, `checkNow` (`setup.ts` `checkNow`, round subject `#c<ms>`), `addAccount`, `now` (`:324`); a client's people start self-serve and mark `who: client` steps, the rest is the team's. Web: `apps/portal/web/src/modules/account/Accounts.tsx`

## Connected to

- **owned-by:** [[platform/spine]] (runs it), [[platform/worker]] (registers `setup.step`, checks, `SetupWatch`)
- **joins:** [[platform/vendors]] (a setup's buys fold into managed billing, Open); outside the tree, autobrowse `do` (`DoRequest.owner`, refused 409 for another owner; autobrowse map `processes/do`)
- **looks-like-but-is-not:** `clients.accounts` (the Shop's one link per site; the registry is the superset: `updateClient`/`addClient` write each saved one's row too, `registerAccounts` in `packages/core/src/clients/index.ts`; migration 0154 backfilled them; turning a site off keeps its row)

## If you change this

- **Hits:** alert keys (a new key format alerts again for changes already told), setup subjects (a new format strands runs in flight), `EVENT_KINDS.account`, the worker's WORKFLOWS (`components.test.ts`)
- **Does not hit:** other workflows' events

## Surfaces

| Surface | Role |
|---|---|
| Account → Accounts (client and Wren's team) | reads; marks, starts, checks now |
| Clients record, Accounts section | reads |
| Part page, a required fact | reads; links to Accounts |
| `setup.step` on the spine | writes facts and runs |
| SetupWatch | writes on recheck, sweep and alerts |
| Now (Wren's home, client Apps page), Accounts badge | reads alerts |
| Canvas, Shop, template plan | reads paused parts |
| DeliveryWatch client mail | reads client alerts |

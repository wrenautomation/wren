# Vendor keys: every call on the right key

2026-10-07. Builds on `2026-10-07-key-store.md` and `2026-10-07-setup-and-vendors.md`.

## Problem

Clients could save their own keys for Exa, YouTube, X, models and Telnyx, but every call still ran on Wren's keys. Only Stripe and mail used the stored key.

## Rule

One resolver decides whose key a call runs on: `vendorKey(db, client, vendor, opts)` in `packages/core/src/vendor-keys.ts`. It answers `{ mode: "own" | "managed", key, source }`.

- Own with a key: read from the key store. The read logs an event with `by: "wren:vendors"` and a reason ("exa read for outreach.discovery").
- Managed: Wren's key, or null when Wren's path holds it (autobrowse's Exa ring, the gateway, the service account). Gated and metered on the client's share.
- Own with no key: refused with "Connect your X key in Account → Vendors". It never falls back to Wren's key.
- No mode: refused with "Pick how X runs in Account → Vendors". A call site that ran on Wren's key before modes existed passes `unset: "managed"`. It keeps running on Wren's key, metered but not gated, so nothing that works today stops.
- Null client: Wren's own work, always managed.

`vendorKeys(deps)` wraps it for one invocation:

- `key()` caches per (client, vendor) for the resolver's life. A refusal is not cached.
- `use()` resolves, gates, runs, then meters (units, plus micros when the call knows its price). An error never carries the key (`scrubKey`).
- The cache is never a module global, so one client's key can't reach another client's call.

Restate journals what a step returns. A key is read inside the step that spends it and never returned from it. `meteredSites` returns only the mode from its key step.

## Own-key reads go straight to the vendor

Wren's keys for Exa, X and YouTube live in autobrowse. A client's key can't go there, because a Restate call journals its input. So `packages/core/src/vendor-direct.ts` calls the vendor from the worker and answers in the shape autobrowse uses for the same route:

| Vendor | Route | Direct call |
|---|---|---|
| Exa | `web GET /search` with `via: "exa"` | `POST api.exa.ai/search`, `x-api-key` |
| Exa | `web GET /people`, `/companies`, `/exa/companies`, `/linkedin/profile`, `/linkedin/company`, `/linkedin/posts` | `POST api.exa.ai/search` or `/contents` (`livecrawl: never`), `x-api-key`; parsed as autobrowse does (`vendor-direct-exa.ts`), 404 when Exa holds no copy |
| X | `x GET /2/*` | `api.x.com/2/*`, Bearer |
| YouTube | `youtube GET /youtube/v3/*` | `googleapis.com/youtube/v3/*`, `x-goog-api-key` |

Any other route on an own key is refused with a reason and is never sent on Wren's key.

The Exa-backed people and LinkedIn routes only pick the key. Their callers gate and meter them as LinkedIn search already, so `meteredSites` and `keyedSites` add no Exa gate or meter there, and a client with no Exa mode stays on Wren's ring. LinkedIn browser legs (`linkedin GET /in|search|company`) are untouched.

Models: an own key goes straight to its provider through `llmForKey` (`packages/llm/src/client.ts`), with no gateway. The provider comes from a `provider:` prefix or the key's shape (`sk-ant-`, `sk-or-`, `gsk_`, `csk-`, `AIza`, `sk-`). Managed keeps the gateway.

Telnyx: `keyedProvider` (`packages/channel-sms/src/keyed.ts`) runs a client's texts on its own Telnyx account or Wren's. If the key or a cap refuses, `send` answers "try later" and nothing leaves. It never throws, because a throw means "maybe sent". Accepted texts are metered in parts and dollars. The messaging profile is the client's `accounts.telnyx`, so a client on its own account sets its own profile there.

Telnyx webhooks: a client on its own account saves its public key (Account → Public Key) with its API key, as `TELNYX_PUBLIC_KEY` in the key store. The phone Worker checks headers and freshness first, then asks `SmsEvents/signer` (`packages/channel-sms/src/signer.ts`) whose key signs the event. The event's number picks the owner: Wren's numbers sit in main, a client's in its database. Own mode: the client's public key, and the event lands only in its database. Wren's numbers and clients on Wren's account: `TELNYX_PUBLIC_KEY` on the Worker. A path naming someone other than the number's owner is 401. Answers are cached 5 minutes per number; a public key is not a secret.

YouTube buckets: a client on its own key reads on its key's daily quota (`ownRoom` on the vendor's own bucket, 3 units a read). Wren and clients on Wren's key share Wren's bucket (`youtubeReadRoom` in `research/src/enrichment/youtube.ts`).

## Call sites changed

Client in context, routed through the resolver:

| Vendor | Call site | How |
|---|---|---|
| Exa | `outreach/src/restate/index.ts` client pass (`meteredSites`, discovery `exaPlaces`) | own: direct; managed: Exa ring; gated, metered |
| Exa | `research/src/restate/enrichment.ts` signals, `base.sites` (news `searchEvents`) | `keyedSites`: routes only, signals gate and meter as before |
| Exa | `apps/worker/src/services.ts` `contentClientsFor` (`meteredSites`) | own: direct; managed: autobrowse; gated, metered. X and YouTube calls there run on the client's own login, not a key, and pass through |
| YouTube | `research/src/restate/enrichment.ts` `youtube` handler (client key) | `clientYouTube`: own API key or service account; gated, metered in Data API units |
| YouTube | `research/src/restate/enrichment.ts` signals `base.youtube` (talks) | same, part `signals.talks` |
| Models | `content/src/restate/desk.ts` client drafts | `meteredModel` with store and `llmForKey` |
| Models | `content/src/restate/inbox-desk.ts` Suggest | now `meteredModel` (it gated before but never metered) |
| Models | `outreach/src/restate/index.ts` client drafts | `meteredModel` with store |
| Models | `services.ts` `mail.triage`, `comments.sort` | `meteredModel` with store |
| Models | `learn/src/score.ts` `judges` (a client's `learn.score`) | `meteredModel` with store |
| Models | `channel-sms` reply labels, via worker `forClient` | `meteredModel`, `unset: "managed"` |
| Models | `channel-email/src/restate/disposition.ts` reply labels and invites | `clientLlm`, `unset: "managed"` |
| Models | `reactivation/src/loop.ts` pass | `clientLlm`, `unset: "managed"` |
| Telnyx | worker `forClient` texts (send, lookup, balance, numbers, registration, keyword replies) | `keyedProvider`, `unset: "managed"` |
| Telnyx | `apps/phone` `/webhooks/telnyx[/<client>]` | `SmsEvents/signer`: the client's public key in own mode |
| Exa | people and LinkedIn routes on a client's `meteredSites`/`keyedSites` (outreach client pass, signals LinkedIn posts, `contentClientsFor`) | own: direct; else Wren's ring; routes only |
| YouTube | `youtube` handler and pool scheduler room for a client key | `youtubeReadRoom`: own key's bucket, else Wren's |
| Models | `research/src/restate/enrichment.ts` extract, pick, opener, signals on a client key | `clientLlm` → `meteredModel`, `unset: "managed"`; a stop ends the pass, no unit held |
| Models | spine rule step (wire `when`, `logic.if`) for a client | `meteredModel`, part `spine.rule`, `unset: "managed"`; a stop answers no |
| Models | `channel-email/src/calls/restate.ts` brief questions for a client | `llmFor` → `meteredModel`, part `calls.brief`, `unset: "managed"` |

Wren's own work (no client in context), staying managed:

- X: `channel-x` content and every `x` site call. Clients have no X channel yet. `meteredSites` maps `x GET /2/*`, so a client's X reads route once one exists.
- YouTube: `youtube-search`, `channel-youtube` content, the `youtube` handler on Wren's niche keys.
- Exa: Wren's niche passes (`exaSearch`, `people`, `profiles`) and the CLI.
- Models: books, search-week, fill, evolve, `watch.triage`, reach on Wren's account, and the Wren pass of every call site above.
- Telnyx: Wren's own texts, `listNumbers`, operator texts, voice calls (`apps/phone`).

## Usage

`vendor_usage` gets a row per call in both modes: client, vendor, mode, units, micros when known, part, run. Account → Vendors already shows each vendor's mode, the last 4 of an own key, and the month's units and dollars per mode (`accounts-console.ts` `vendors`, `Vendors.tsx`). No portal change.

Prices: Telnyx gives dollars per text. Models and Exa use the `VENDORS` micros where set. X and YouTube are counted in units.

## Tests

- `core/test/integration/vendor-keys.test.ts`: own vs managed, no cross-client reads, no silent fallback, cache, meter in both modes, key scrubbed from message, stack and cause, `meteredSites` own vs managed vs no mode, no journaled step holds the key, `keyedSites` routes only, `meteredModel` own vs gateway vs `unset`.
- `core/src/vendor-direct.test.ts`: the three direct calls with a fake fetch, refusals, units.
- `channel-sms/src/keyed.test.ts`: own vs managed account, no key = try later, a cap isn't metered, a carrier error carries no key.
- `research/src/enrichment/youtube-keyed.test.ts`: own vs service account, units, a stop ends the pass.
- `llm/src/client.test.ts`: provider from a key.
- `core/src/vendor-direct-exa.test.ts`: people, LinkedIn profile, company and posts on an own key, 404 with no copy, no key in an error.
- `channel-sms/test/integration/signer.test.ts`: Wren's number, own account's public key, managed client on Wren's key, a wrong path refused.
- `apps/phone/test/worker.test.ts`: a client's signature passes, another client's or Wren's fails on its number, Wren's still passes.
- `channel-email/test/integration/per-client-reads.test.ts`: an own YouTube key reads on its own bucket while Wren's is spent.
- `research/src/restate/units.test.ts`: a vendor stop ends at once, nothing held.

## `crm` on the worker (2026-10-09)

The CLI holds only the store's public key, so it can't read a client's key. The worker can. `crm run`, `lookup`, `redraft` and `settle` run there, as handlers of `CrmRun/<client>` (`reactivation/src/crm-run.ts`), exclusive per client:

| Handler | One call | Part |
|---|---|---|
| `run` | one round of each due stage, `limit` units each (10 by default, 25 at most), `only`, `linkedin` | `reactivation.run` |
| `lookup` | one slice of people (25 at most), `concurrency` up to 4; `again` with `after` goes past the last slice | `reactivation.lookup` |
| `redraft` | named enrollments (25 at most), or untouched drafts past `after` | `reactivation.redraft` |
| `settle` | kept moves past `after` (100 at most) | `reactivation.settle` |

- Each call is one step: its ledger row in the client's database (`crm run`, `crm lookup`, `crm redraft`, `crm settle`), then its work. The model and sites are made inside it, with the run's id on every usage row.
- Model: `meteredModel`, `unset: "managed"`, the client's own key when it has one. `lookup` now also settles moves with the family judge on that model, as `run`'s lookup stage does.
- Sites (`run`, `lookup`): `meteredSites` over the ingress, `unset: "managed"`. Exa, X and YouTube read on the client's own key when it brought one, gated and metered on its share. No mode: Wren's path, metered on the client's share, not gated. LinkedIn account reads are gated on the client's LinkedIn setup, as signals; a stop parks them like a cap and the rest go on by search. `redraft` and `settle` make no sites.
- The CLI loops calls through the ingress: `run` until nothing is due, a stage stops, or a round changes nothing; `lookup` until `--limit`, nobody is left, or a slice stops; `redraft` and `settle` slice by slice past the last id. `--verifier` is gone from `run`: the worker's verifier runs.
- `seed-demo` stays in the CLI on Wren's keys.
- Tests: `reactivation/test/integration/crm-run.test.ts`, `redraft-adversarial.test.ts` (slices), `lookup.test.ts` (settle slices), `core/test/integration/vendor-keys.test.ts` (`meteredSites` with `unset`).

## Decisions

- 2026-10-09: `redraft`, `settle` and `lookup` became `CrmRun` handlers, each a bounded slice the CLI loops. A Lambda call has 15 minutes; `--all` over hundreds of drafts doesn't fit one.
- 2026-10-09: `seed-demo` stays on Wren's keys. It refuses any client but a demo one, the demo client is Wren's showcase (client zero's work), and nobody brings keys for it. Moving it would add a worker handler for no change in whose key pays.
- 2026-10-09: no-mode default for `CrmRun` sites is `unset: "managed"`: Wren's key, metered on the client's share, not gated. That is how signals treat a client with no mode (talks: "No mode: Wren's, metered"; news stays on Wren's ring) and how `vendorKeys.use` treats `unset`. Refusing instead would stop every lookup, signals and events stage for a client that never opened Account → Vendors.
- 2026-10-09: `meteredSites` takes `unset`. It applies to key vendors (Exa, X, YouTube) only. LinkedIn is a login: no mode stays "Needs setup", as in signals.

## Left

- Nothing from this design. The no-mode default can tighten to `refuse` once every client has picked its modes.

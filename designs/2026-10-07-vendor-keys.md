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
| X | `x GET /2/*` | `api.x.com/2/*`, Bearer |
| YouTube | `youtube GET /youtube/v3/*` | `googleapis.com/youtube/v3/*`, `x-goog-api-key` |

Any other route on an own key is refused with a reason and is never sent on Wren's key.

Models: an own key goes straight to its provider through `llmForKey` (`packages/llm/src/client.ts`), with no gateway. The provider comes from a `provider:` prefix or the key's shape (`sk-ant-`, `sk-or-`, `gsk_`, `csk-`, `AIza`, `sk-`). Managed keeps the gateway.

Telnyx: `keyedProvider` (`packages/channel-sms/src/keyed.ts`) runs a client's texts on its own Telnyx account or Wren's. If the key or a cap refuses, `send` answers "try later" and nothing leaves. It never throws, because a throw means "maybe sent". Accepted texts are metered in parts and dollars. The messaging profile is the client's `accounts.telnyx`, so a client on its own account sets its own profile there.

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
| Models | `channel-sms` reply labels, via worker `forClient` | `meteredModel`, `unset: "managed"` |
| Models | `channel-email/src/restate/disposition.ts` reply labels and invites | `clientLlm`, `unset: "managed"` |
| Models | `reactivation/src/loop.ts` pass | `clientLlm`, `unset: "managed"` |
| Telnyx | worker `forClient` texts (send, lookup, balance, numbers, registration, keyword replies) | `keyedProvider`, `unset: "managed"` |

Wren's own work (no client in context), staying managed:

- X: `channel-x` content and every `x` site call. Clients have no X channel yet. `meteredSites` maps `x GET /2/*`, so a client's X reads route once one exists.
- YouTube: `youtube-search`, `channel-youtube` content, the `youtube` handler on Wren's niche keys.
- Exa: Wren's niche passes (`exaSearch`, `people`, `profiles`) and the CLI.
- Models: books, search-week, fill, evolve, `watch.triage`, `learn.score`, reach on Wren's account, and the Wren pass of every call site above.
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

## Left

- LinkedIn and people routes backed by Exa in autobrowse (`/linkedin/posts`, `/people`, `/linkedin/profile`) are classed `linkedin`. They run on Wren's ring for every client.
- Model call sites still on Wren's key with no client meter: enrichment's client-niche model stages, the spine rule step, the calls brief, CLI `crm`. The CLI holds only the store's public key, so it can't read a client's key.
- A client's own Telnyx account: its webhooks are signed with its own public key, and `apps/phone` checks only Wren's. Status and inbound for that client fail verification until the phone worker reads the client's public key.
- Own-key YouTube reads still wait on Wren's YouTube bucket (`youtubeRoom`).
- `research/src/companies/events.ts` reads `results` from `web /search`, which answers `hits`. Exa news hits come back empty on both keys. Found here, not fixed.

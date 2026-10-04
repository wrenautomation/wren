# Components and the marketplace

Living doc. Started 2026-10-04. William moved componentizing (was "when a second client needs the same part") and the marketplace (was Parked) to now on 10-04. His 10-03 words: "componentize all the little features", and a marketplace and mod system for the DSLs, "especially autobrowse". The autobrowse half is `autobrowse/designs/2026-10-04-mods.md`.

## Why

The plan is to sell automation as a service, fulfilled by wiring wren's parts together per client, and later to sell those parts as SaaS. Today the parts are packages, services and apps with no shared shape. Reactivation is the only one a client can have, and having it means a hand-set key in `clients.products`. A component gives every feature one manifest: what it is, what it needs, what it gives, and whether a client can have it yet. With that, the catalog, installs, forms, gating and the "what can we sell" list all come from one source.

## The manifest

Each package exports its components from `src/components.ts`:

```ts
defineComponent({
  id: "reactivation",                 // the key in clients.products; product.feature for new ones
  name: "Lead reactivation",
  blurb: "Wakes old leads in the client's CRM and books them in.",
  icon: "repeat",
  for: "client",                      // "client": installable per client; "wren": runs Wren's own business
  ready: true,                        // false: runs for Wren, not yet per client; the catalog says what's missing
  missing: [],                        // when not ready: what stands between it and a client, in plain words
  settings: reactivationSettings,     // zod; parses its block in clients.products, `{}` valid
  requires: { components: ["sms.texts"], accounts: ["gmail"] },
  provides: { services: ["Reactivation"], loops: ["ReactivationLoop"], records: ["reactivation.contact"], apps: ["reactivation"] },
  effects: ["sends"],
});
```

`defineComponent` and the type live in `@wren/core/components` (a foundation: it knows the shape, not any component). The worker (`apps/worker/src/services.ts`, the composition root) and the portal collect every package's list into `COMPONENTS`.

## Every feature is in one

A test in `apps/worker` checks the inventory:

- Every Restate service the worker binds is provided by exactly one component, or named in `PLATFORM` (ConsolePortal, Runs, the loop factory's helpers) with a reason.
- Every record type and every portal app belongs to exactly one component.
- Every `requires` names a real component or account site.
- `ready: false` comes with a non-empty `missing`.

That test is what "componentize all the little features" means here. A new service with no component fails CI.

## The first inventory

The implementer reads `map/objects/_index.md` and each package, then writes the manifests. Expected shape (ids may change, and each change is logged):

| Package | Components |
|---|---|
| research | `research.discovery`, `research.crawl`, `research.people`, `research.verify`, `research.lead_sheet`, `research.dossier` |
| channel-email | `email.sequences`, `email.replies`, `email.inbox_health`, `email.experiments` |
| channel-sms | `sms.texts`, `sms.reminders`, `sms.forms` |
| reactivation | `reactivation` (ready) |
| delivery | `delivery.portal`, `delivery.invoices`, `delivery.reviews`, `delivery.contract` |
| content + channel-youtube, -linkedin, -x, -tiktok, -reddit | `content.posting`, `content.planner` |
| channel-meta | `ads.meta` |
| channel-search | `search.watch` |
| outreach | `reach.outreach` |
| books | `books` (for: wren) |
| video | `video.demo` |
| offers | `offers` (for: wren) |

## Ready for a client

A component is `ready` when all four hold:

1. Its settings block parses from `clients.products[id]`, and `{}` is a valid start.
2. It runs against the client's own database (`wren_client_<id>`), the way reactivation does.
3. Its loop goes over the clients that have it installed, and skips the rest.
4. Its records are served per client, and its app shows only where installed.

Most of the outbound stack runs for Wren's niches on the main database, so it starts `ready: false`. Making it run per client is the fulfillment build for client #1, and it gets its own doc once C2 lands (the order comes from the offer: lead sheet, sequences, replies, booking).

## Installing

- `ConsolePortal.install {client, component, settings}`: operator only. It parses the settings, checks `requires` (components installed, accounts in `clients.accounts`), refuses `ready: false` and `for: "wren"`, and writes `clients.products[id]`. Installing a component with effects asks for a typed confirm, as handler forms do.
- `ConsolePortal.uninstall {client, component}`: writes null, which `updateClient` already turns into a delete. It refuses while another installed component requires this one. The component's data stays in the client's database.
- `ConsolePortal.configure {client, component, settings}`: the same parse, without install's checks.
- Each one writes a `runs` row, so it shows on the run trail.
- A module gains `component?: string`. The portal shows a client an app only when that component is installed. An operator sees uninstalled apps marked "not installed".

## The marketplace

A **Marketplace** app in the portal over `COMPONENTS`:

- **Catalog**: a List of components, filterable by ready, for, and has effects. A record shows the blurb, what it needs, what it provides, what's missing if not ready, and the settings form (`formOf` from handler forms over the settings schema, through `zod`'s JSON schema).
- **Operator**: Install to a client, with the settings form and the requirements checklist. Configure and Uninstall from the client's record.
- **Client owner**: sees `for: "client"` components, both ready and coming. "Ask for this" opens a thread with Wren in the portal (the delivery threads) and pings Discord. Installing stays Wren's call: pricing and scope are William's.
- **Browser mods**: a read-only tab listing autobrowse mods from the npm registry (keyword `autobrowse-mod`), each with its permissions. Installing one happens on the desk (see the mods doc).
- The Clients app's record gains a Components tab: installed components with their settings, plus Install.

No prices on any of these pages.

## Phases

### C1. Manifests and the inventory test

`@wren/core/components`, every package's `components.ts`, `COMPONENTS` in the worker and portal, the inventory test, and `reactivation` marked ready with its existing settings schema. No behavior changes.

### C2. Install, configure, gate, catalog

The three handlers with the runs rows, module gating by component, the Marketplace app (Catalog, operator install, client "Ask for this", Browser mods tab), and the Clients Components tab. Tests: install refuses not-ready, wren-only and missing requirements; uninstall refuses a required component; a client sees only installed apps. Screenshots at 1360 and 390 as the operator and as the demo.

### C3. The first conversions

The delivery components and `sms.reminders` already read per client. Finish the four conditions for them and flip them to ready. Then write `designs/<date>-outbound-per-client.md` for the outbound stack.

## Done when

- Every service, record and app belongs to a component, and CI fails on a new one that doesn't.
- The demo client's apps come from its installed components.
- The Marketplace lists every component, with what's missing on the ones that aren't ready.
- An operator can install, configure and uninstall a ready component, and each change is on the run trail.
- Gates pass.

## Decision log

- 2026-10-04: Written. William moved componentizing and the marketplace to now. Components key `clients.products`, so the existing reactivation block is already an install. The inventory test, not a wiki list, is the source of truth for "every feature is a component". Client owners ask instead of installing, since pricing is William's. Wren-side data packs (templates, looks) use the same `mod.json` shape as autobrowse mods, but wait until outbound runs per client: until then there is nothing for a client to install them into.

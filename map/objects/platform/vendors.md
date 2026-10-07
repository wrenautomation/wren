---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ 85f81a2
entity: packages/core/src/vendors.ts:1
---

# vendors (modes, buckets, metering, usage lines)

Metered services (Exa, YouTube, X, LinkedIn account reads (20 a day, burst 4) and LinkedIn reads by search (`linkedin_search`, free, no quota, 2026-10-07), models, Reddit, Telnyx) with a public price and a quota per key. Per client: `own` (the client's key in the key store, their bill) or `managed` (Wren's key, a daily share, a monthly cap, billed through Books). No mode is "Needs setup". Wren is client zero: null client, always managed.

## Why this shape

A read limit belongs to a key, so a bucket is (vendor, key): `<vendor>:own:<client>` or `<vendor>:managed`. A managed client gets the smallest of its share, the clients' pool (quota less Wren's reserve) and the whole quota, so clients never take Wren's half. Keys never sit in Postgres: SSM SecureStrings at credvault's owner path, the row keeps the name.

## Shape

- `vendor_modes` (`packages/core/src/vendor-schema.ts:28`): unique client+vendor; mode, key_name, per_day, cap_cents (both default 0: nothing runs)
- `vendor_usage` (`:62`): one row per metered call; bucket, units, est. micros; no FK (a ledger)
- `books.usage_lines` (`packages/books/src/schema.ts`): one owner's month of one managed vendor; draft or on_invoice; `writeUsageLines` (`packages/books/src/usage-lines.ts:36`), run by the Books day for this month and last
- Code (`vendors.ts`): `VENDORS` (`:34`), `vendorSettings` (`:159`, `wren_settings` block `vendors`: markupPct 0, reservePct 50, managedForClients all but linkedin), `setOwnKey` (`:280`), `setManaged` (`:257`), `gate` (`:381`; a free vendor skips the $ cap, its share bounds it), `roomToday` (`:395`, the gate without the cap: the page's "Today"), `meter` (`:480`), `usageSince` (`:523`)
- `KeyStore`: `pgKeyStore` in `packages/core/src/keys.ts` (sealed rows in `client_secrets`, events in `client_secret_events`); refs and shapes in `key-refs.ts`; `setOwnKey` binds a staged ref
- Whose key a call runs on: `vendorKey` / `vendorKeys` (`packages/core/src/vendor-keys.ts`); own reads go straight to the vendor (`vendor-direct.ts`); `meteredSites`, `keyedSites`, `meteredModel` (`metered.ts`); texts `keyedProvider` (`packages/channel-sms/src/keyed.ts`); call sites in `designs/2026-10-07-vendor-keys.md`
- GCRA: `packages/core/src/buckets.ts` (research re-exports it)
- `AccountsConsole` `vendors`, `setVendor`, `usage` (`packages/core/src/accounts-console.ts`): managed needs money (an admin); an own key comes as a staged ref (`keyRef`), never the key. `usage` totals Wren's key only; own-key use is its own line, billed to the client by the vendor. Web: `apps/portal/web/src/modules/account/Vendors.tsx`, `summary.tsx` (Vendor usage)

## Connected to

- **joins:** [[books/bill]] (usage lines sit next to bills); [[books/vendor]] is a vendor Wren pays, not a metered one; research collectors: a metered one (`linkedin`, `demand`) names its `vendors`; the Enrichment `signals` handler gates each before a pass and meters each answered unit (`packages/research/src/restate/enrichment.ts`); a client's LinkedIn reads use its own login on `own` (`clientLinkedin`)
- **looks-like-but-is-not:** `books.usage` (AWS spend from Cost Explorer), research's per-source buckets (still count their own tables for Wren)

## If you change this

- **Hits:** client caps and shares, draft lines, prices on the Vendors page
- **Does not hit:** invoices (lines are drafts; a person puts them on Wise)

## Surfaces

| Surface | Role |
|---|---|
| Account → Vendors (Wren's team) | writes modes, shares, caps |
| Account → Vendors (client) | reads mode, room, usage, cap |
| Clients → Vendor usage | reads this month across clients |
| Books day | writes usage lines |

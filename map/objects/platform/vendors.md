---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-19 @ cedaf9ee
entity: packages/core/src/vendors.ts:1
---

# vendors (modes, buckets, metering, usage lines)

Metered services (Exa, YouTube, X, LinkedIn account reads (20 a day, burst 4) and LinkedIn reads by search (`linkedin_search`, free, no quota, 2026-10-07), models, Reddit, Telnyx) with a public price and a quota per key. Per client: `own` (the client's key in the key store, their bill) or `managed` (Wren's key, a daily share, a monthly cap, billed through Books). No mode is "Needs setup". Wren is client zero: null client, always managed.

## Why this shape

A read limit belongs to a key, so a bucket is (vendor, key): `<vendor>:own:<client>` or `<vendor>:managed`. A managed client gets the smallest of its share, the clients' pool (quota less Wren's reserve) and the whole quota, so clients never take Wren's half. Keys never sit in Postgres: SSM SecureStrings at credvault's owner path, the row keeps the name.

## Shape

- `vendor_modes` (`packages/core/src/vendor-schema.ts:28`): unique client+vendor+`purpose` (`default`, `bulk`, `drafts`); mode, key_name (the `ks_` ref that picks one key), per_day, cap_cents (both default 0: nothing runs). Gate, meter and the Vendors page read the `default` row; other purposes are own-key rows (`setPurposeKey`, `wren keys use`)
- `vendor_usage` (`:64`): one row per metered call; bucket, units, est. micros, `key_id` (the key's `keyId` where Wren holds the value, null where a path holds it); no FK (a ledger)
- `books.usage_lines` (`packages/books/src/schema.ts`): one owner's month of one managed vendor; draft or on_invoice; `writeUsageLines` (`packages/books/src/usage-lines.ts:36`), run by the Books day for this month and last; the next month's bill in [[clients/engagement]] carries the drafts and marks them `on_invoice` when the invoice is recorded
- Code (`vendors.ts`): `VENDORS` (`:34`), `vendorSettings` (`:159`, `wren_settings` block `vendors`: markupPct 0, reservePct 50, managedForClients all but linkedin), `setOwnKey` (`:316`), `setPurposeKey` (`:339`), `setManaged` (`:290`), `gate` (`:471`; a free vendor skips the $ cap, its share bounds it), `roomToday` (`:485`, the gate without the cap: the page's "Today"), `meter` (`:573`; takes `keyId`), `usageSince` (`:619`), `usageByKey` (`:647`, spend per key id since a date)
- `KeyStore`: `pgKeyStore` in `packages/core/src/keys.ts` (sealed rows in `client_secrets`, events in `client_secret_events`); refs, shapes and the label rule in `key-refs.ts`; `setOwnKey` binds a staged ref. A key is (client, name, `label`): one live row per label (`default`, `bulk-2`), the account part of its address (`exa@bulk-2`). `keyId` (`key-id.ts`): first 12 hex of the SHA-256 of the trimmed value, a copy of credvault's rule pinned by a test vector
- Whose key a call runs on: `vendorKey` / `vendorKeys` (`packages/core/src/vendor-keys.ts`; by `purpose`: the purpose's row, else `default`'s; own with no key is refused, never Wren's; `VendorKey.id` goes to `meter`); own reads go straight to the vendor (`vendor-direct.ts`, Exa people and LinkedIn routes in `vendor-direct-exa.ts`); `meteredSites`, `keyedSites`, `meteredModel` (`metered.ts`); texts `keyedProvider` (`packages/channel-sms/src/keyed.ts`); Telnyx webhooks on an own account check the client's saved `TELNYX_PUBLIC_KEY` (`packages/channel-sms/src/signer.ts`, `SmsEvents/signer`); an own YouTube key reads on its own bucket (`ownRoom`, `youtubeReadRoom`); call sites in `designs/2026-10-07-vendor-keys.md`
- GCRA: `packages/core/src/buckets.ts` (research re-exports it)
- `AccountsConsole` `vendors`, `setVendor`, `usage` (`packages/core/src/accounts-console.ts`): managed needs money (an admin); an own key comes as a staged ref (`keyRef`), never the key. `usage` totals Wren's key only; own-key use is its own line, billed to the client by the vendor. Web: `apps/portal/web/src/modules/account/Vendors.tsx`, `summary.tsx` (Vendor usage)

## Connected to

- **joins:** [[books/bill]] (usage lines sit next to bills); [[books/vendor]] is a vendor Wren pays, not a metered one; research collectors: a metered one (`linkedin`, `demand`) names its `vendors`; the Enrichment `signals` handler gates each before a pass and meters each answered unit (`packages/research/src/restate/enrichment.ts`); a client's LinkedIn reads use its own login on `own` (`clientLinkedin`)
- **looks-like-but-is-not:** `books.usage` (AWS spend from Cost Explorer), research's per-source buckets (still count their own tables for Wren)

## If you change this

- **Hits:** client caps and shares, draft lines, prices on the Vendors page; the Accounts page's keys (W2) read `client_secrets.label` and `usageByKey`
- **Does not hit:** invoices (lines are drafts; a person puts them on Wise)

## Surfaces

| Surface | Role |
|---|---|
| Account → Vendors (Wren's team) | writes modes, shares, caps |
| Account → Vendors (client) | reads mode, room, usage, cap |
| Clients → Vendor usage | reads this month across clients |
| Books day | writes usage lines |
| `wren keys put --label`, `keys use --purpose --key` | writes labelled keys, one purpose row per key |

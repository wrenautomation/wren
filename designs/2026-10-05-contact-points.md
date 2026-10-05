# Contact points: every way a firm publishes to be reached (2026-10-05)

## Answer first

Every stored page is read once, free, for phones, LinkedIn links and social profiles. Each find lands in `contact_points`, one row per (firm, kind, value). SMS, the lead sheet and later channels read that one table. Before this, 12,306 firms had a phone on file and `sms_contacts` was 0. LinkedIn links were only read for the next week's compose people, and socials not at all.

## What it reads

| Kind | From | Value |
|---|---|---|
| `phone` | `tel:` links (or the kept `tel_hrefs` when the page is out of reach), then visible text | E.164; toll-free kept, lands unreachable at the lift |
| `linkedin_company` | any `/company/<slug>` link | `https://www.linkedin.com/company/<slug>/` |
| `linkedin_person` | any `/in/<slug>` link | canonical profile URL; tied to a person only when exactly one held person's name is near it |
| `x`, `instagram`, `facebook`, `youtube`, `tiktok` | any profile link, JSON-LD `sameAs` too | one canonical URL per profile; share buttons, pixels, embeds, posts and template defaults skipped |

`pages` counts the pages carrying a value. A footer link counts on every page and outranks a one-off mention.

## Where it runs

- Stage `contacts` in `PoolScheduler/{niche}`, after `scan`, 200 pages a pass (`DEFAULT_LIMITS.contacts`).
- `Enrichment/<niche>/contacts` by ingress with a bigger `limit` to catch up.
- One `contact_scan` enrichment per page and version. A new `CONTACTS_VERSION` re-reads every page.
- Archived pages come back from S3: about 68k GETs to backfill, about $0.03.

## Who reads it

Every reader goes through the view `own_contact_points`. It drops any value found on more than 5 firms' sites.

- `liftPhones` (SMS) reads `kind = 'phone'` instead of parsing pages.
- `lead_sheet`: new `phone` and `socials` columns. LinkedIn columns fall back to the published link.

## Decision log

- One store, not one parser per channel. William, 2026-10-05: "extracting as much information as possible ... SMS LinkedIn etc ... first class priority".
- Published links never write `companies.linkedin_url` or `people.linkedin_url`. Those stay confirmed by the Exa read (homepage match). A firm's site can link a partner or a parent. The sheet shows the confirmed link first.
- A profile goes to a person only on a unique name match. Two people with the same name, or no name nearby: the link stays on the firm with `person_id` null.
- The phone parser moved to `@wren/research/phones`. research cannot import channel-sms, which depends on research.
- Deterministic and free, so it runs every pass with no spend gate.
- Shared values dropped at read time, not write time (2026-10-05, first 18k pages). One number sat on 64 firms' sites, one Facebook "profile" on 263 (the old `xmlns:fb` namespace URL), and a domain seller's whole social set on 11 parked domains. Rows are kept, so the cutoff can move.
- No email column here: `email_scan` already owns addresses.

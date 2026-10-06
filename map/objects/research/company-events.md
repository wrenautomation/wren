---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-06 @ cad8949
entity: packages/research/src/schema.ts
---

# company events (dated news)

A firm's acquisition, merger, funding round or new leader in the last 6 months, each a `news` finding (company_id, `value.event`, `value.date`, `value.title`, `source_url`). Where each firm's search stands is a `company_event_checks` row.

## Why this shape

Free only: Google's page first, Exa's free credit when Google is out for the day. A keyword read of a dated headline is cheap and cited; a rename alone or an undated hit is never kept, so a reason to call always has a date and a link.

## Shape

- `company_event_checks`: one per company; state found/none/unresolved/capped; `tried` counts in Google's daily budget (`googleLeft`)
- Search and read: `searchEvents`, `readEvents`, `eventDate` in `packages/research/src/companies/events.ts`; write: `recordCompanyEvents` (`companies/store.ts`)
- Stage: `checkCrmEvents` (`packages/reactivation/src/events.ts`), `crm run` stage `events`, every 30 days per firm
- Score: `newsFinding` (`packages/reactivation/src/score.ts`), POINTS.news 25

## Connected to

- **joins:** [[reactivation/crm-contact]] (a reason to reach out in its score), briefs (a cited fact), movers (a found mover's new firm is searched)
- **looks-like-but-is-not:** a person's `news` finding (about them, not their firm); hiring (`company_checks`)

## If you change this

- **Hits:** scores, briefs, Google's daily budget shared with the profiles and lookups stages
- **Does not hit:** the reactivation loop (it never runs this stage)

## Surfaces

| Surface | Role |
|---|---|
| `wren crm run` (stage `events`) | writes |
| Portal Run page, step "Check firm news" | reads |

## See

- Design: `designs/2026-10-06-company-events.md`

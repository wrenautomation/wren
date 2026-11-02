---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-02 @ 3ab0d2c0 + WA-999 phase 3 (cold email reads campaigns)
entity: packages/pipeline/src/metro-campaigns.ts:146
---

# campaign

One offer, one audience and one CTA ladder, run on set accounts under set caps. A campaign is a group of the metro body with a `campaign` map (`MetroGroup.campaign`). Design: `designs/2026-11-02-campaigns.md`.

## Why this shape

A group already draws, folds, versions, diffs and merges, so a campaign needs no second home. The id is the group id and never changes, so phase 2 numbers join across versions. Every field is optional: `campaign: {}` makes a group a campaign.

The `default` campaign is computed, never stored: it holds every station outside a campaign group, status `live`, fields unset, so loops keep their global settings. No group may take the id `default`.

## Shape

- `CampaignFields` (`metro-campaigns.ts:61`): offer, audience (segment or out lines), ctas (ordered `{label, station}`), accounts (per channel), caps (per `<channel>.<act>` a day), from, until, status
- `campaignsOf(body)` (`:146`): the default first, then each campaign in body order, unset fields from the nearest campaign above. Accounts and caps merge by key. A paused or ended parent holds a live child.
- `campaignOfStation` (`:203`): a station's nearest campaign, else `default`
- `checkCampaigns` (`:211`), run by `checkMetro` after the group rules: reserved id, known fields, segment active, audience lines are out lines, each CTA station inside the group (or below) with action `cta`, `form`, `visit` or `book`, channels in `CAMPAIGN_CHANNELS`, caps 0–10000 and not over the parent's, dates in order
- File form: `campaign`, `audience`, `ctas` types in `metro-file.ts`
- Merge: `campaign` is one field. Both sides changed it is a conflict, so the CTA ladder never interleaves.
- Loops (phase 3): `liveCampaigns(body, day)` (`metro-campaigns.ts`): live, inside its UTC dates, body order, the default last; `liveCampaignsOf(db, now)` (`store.ts`) on the newest shape. A channel sits below the shape, so a loop reads `LoopCampaign` and the cap function `capLeft` (smaller of global left and campaign left) from `@wren/starling-core/campaigns`; the worker passes the live campaigns in. `CAMPAIGN_ACTS` lists the acts a loop spends (`email.opener`); a cap on another act of a listed channel is refused.
- Cold email: `campaignSweeps` (`compose-scheduler.ts`). A campaign whose `accounts.email` is a niche sender composes from that inbox, its offer's plan rules, its segment's people (person pass only), under its `email.opener` cap, before the default. It stamps `enrollments.campaign` ([[email/enrollment]]).
- Numbers: `campaignNumbers` (`campaign-numbers.ts`) per campaign: people in, converted (reached a CTA), open now, deals. Read off journey arrivals, each on the version it was on, so ids join across versions. A journey a new version carried counts for deals, not as a person in. A parent counts its children; a person in two campaigns counts in both. Acts and cost wait on the act stamp of every loop (phase 3).

Citations: `packages/pipeline/src/metro-campaigns.ts:146`, `packages/starling/core/src/campaigns.ts`, `packages/starling/channels/email/src/restate/compose-scheduler.ts`, `packages/pipeline/src/metro.ts`, `packages/pipeline/src/campaign-numbers.ts`, `apps/cli/src/campaigns.ts`

## Connected to

- **is:** a [[platform/shape]] group
- **joins:** an offer of the registry; a [[leads/segment]]; `LineEntry.campaign` stays text (a `utm_campaign` word) until phase 3
- **not:** the email worker's `Campaign` (`compose-scheduler.ts:39`, a niche send plan), a Meta campaign, an SMS 10DLC registration

## If you change this

- **Hits:** `checkMetro` (every shape save, import and draft), the metro file schema, `wren campaigns`; the cold email top-up (`ComposeScheduler`, each pass)
- **Does not hit:** the reach, content and SMS loops yet (phase 3, next); the runtime; the map UI (phase 5)

## Surfaces

| Surface | Role |
|---|---|
| `wren campaigns list\|show\|numbers` | reads |
| `wren shape` export/import, draft `set` op | writes |
| `ComposeScheduler/<niche>` | reads (live campaigns, each pass) |

## See

- Source: `packages/pipeline/src/metro-campaigns.ts`, `packages/pipeline/src/campaign-numbers.ts`, `apps/cli/src/campaigns.ts`

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-02 @ 44745874 + WA-999 phase 1 (model, check rules, metro file, `wren campaigns`; no loop reads it yet)
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

Citations: `packages/pipeline/src/metro-campaigns.ts:146`, `packages/pipeline/src/metro.ts`, `apps/cli/src/campaigns.ts`

## Connected to

- **is:** a [[platform/shape]] group
- **joins:** an offer of the registry; a [[leads/segment]]; `LineEntry.campaign` stays text until phase 2
- **not:** the email worker's `Campaign` (`compose-scheduler.ts:39`, a niche send plan), a Meta campaign, an SMS 10DLC registration

## If you change this

- **Hits:** `checkMetro` (every shape save, import and draft), the metro file schema, `wren campaigns`
- **Does not hit:** any loop or the runtime (phase 3); the map UI (phase 5)

## Surfaces

| Surface | Role |
|---|---|
| `wren campaigns list\|show` | reads |
| `wren shape` export/import, draft `set` op | writes |

## See

- Source: `packages/pipeline/src/metro-campaigns.ts`, `apps/cli/src/campaigns.ts`

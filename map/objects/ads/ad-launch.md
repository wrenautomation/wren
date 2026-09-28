---
type: object
cluster: ads
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-meta/src/schema.ts:13
---

# ad-launch

One Meta ad ladder we made (campaign → ad set → creative → ad) and whether it spends. Table `ad_launches`; the spec is `LaunchSpec`.

## Why this shape

A launch is PAUSED; `start` is the one command that spends and must name the daily budget; the box's spend gate still asks a person for every ACTIVE write (`restate.ts:1`, `ads.ts:1`). `AdsWatch` only ever stops spend: guard amount spent with nothing to show → paused, one line to Discord (`launches.ts:1`, `watch.ts:1`). A winner becomes a content idea, never a draft (`bridge.ts:1`).

## Shape

- `name`, `ad_account_id`, `campaign_id`, `adset_id`, `creative_id`, `ad_id`, `spec`, `status` (paused | active | stopped), `daily_budget_usd`, `started_at`, `stopped_at`, `stop_reason` (`schema.ts:17`–`29`)
- `LaunchSpec` (`ads.ts:39`); `recordLaunch` (`launches.ts:12`)

Citations: `packages/channel-meta/src/schema.ts:13`

## Connected to

- **produces:** [[content/idea]] (source ads)
- **joins:** [[platform/settings]] (`WREN_META_*`), autobrowse's `meta` site

## If you change this

- **Hits:** `ads.ts`, `launches.ts:17`, `restate.ts` (`Ads` handlers), `watch.ts`, `wren ads *`, `walkthrough/02-meta-ads.md`
- **Does not hit:** content adapters on the same site (`channel-meta/src/content.ts`)

## Surfaces

| Surface | Role |
|---|---|
| `Ads.launch/start/stop` | writes |
| `AdsWatch/default` | pauses |
| `wren ads launches/insights/leads` | read |

## See

- Source: `packages/channel-meta/src/restate.ts`

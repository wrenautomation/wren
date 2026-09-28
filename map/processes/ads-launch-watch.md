---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[platform/settings]]", "[[content/media]]"]
produces: ["[[ads/ad-launch]]", "[[content/idea]]"]
---

# ads-launch-watch

A spec becomes a paused Meta ad ladder; a person starts it with a budget; a daily guard stops what spends for nothing and turns winners into content ideas.

## Input → Movement → Output

A `LaunchSpec` from `wren ads launch`. `Ads.launch` makes campaign → ad set → creative → ad, PAUSED, each Graph call journaled through autobrowse's `meta` site, and records the ladder in `ad_launches`. `Ads.start` names the daily budget and flips ACTIVE (the box's spend gate asks a person). `AdsWatch/default` reads seven days of insights daily, pauses a launch that spent the guard with no clicks or results, adds an idea for a winner, and posts one line.

## Why this shape

Spend never starts by accident and the watch only ever stops it. A retry after a crash resumes after the last object made, never a second campaign.

## Steps

1. `Ads` handlers (`packages/channel-meta/src/restate.ts`); Graph calls (`ads.ts`).
2. Record (`launches.ts:12`, `:17`).
3. Watch (`watch.ts`); verdicts and the idea (`bridge.ts:237`, `:240`).
4. Lead forms and leads (`Ads.leadForm/leadForms/leads`).

## If you change this

- **Hits:** [[ads/ad-launch]], `wren ads`, `walkthrough/02-meta-ads.md`
- **Does not hit:** the content adapters on the same site

## Surfaces

| Surface | Role |
|---|---|
| `wren ads launch/start/stop/insights/leads` | drives |
| `Ads`, `AdsWatch/default` | run |

## See

- Objects: [[ads/ad-launch]]
- Source: `packages/channel-meta/src/restate.ts`

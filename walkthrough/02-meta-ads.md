# 2 · Meta ads

**Goal:** a campaign from a JSON file, spending only when you say, watched
daily, stopped by itself when it burns money for nothing.

Needs the Meta app + token on the box (autobrowse guide 3) and a payment
method on the ad account.

## Look around

```sh
pnpm wren ads accounts                    # act_…  name  currency  status
pnpm wren ads campaigns
pnpm wren ads interests "shopify"         # id  name  audience  path — for the spec
```

## The spec

`ads/founders.json` (any path):

```json
{
  "name": "founders · spend gate",
  "objective": "OUTCOME_TRAFFIC",
  "dailyBudgetUsd": 20,
  "targeting": { "countries": ["US", "CA"], "ageMin": 25, "ageMax": 55,
                 "interests": [{ "id": "6003020834693", "name": "Shopify" }] },
  "optimizationGoal": "LINK_CLICKS",
  "creative": {
    "message": "every buy asks me first. the spend gate, in 40 seconds.",
    "link": "https://wrenautomation.com",
    "headline": "Wren Automation",
    "callToAction": "LEARN_MORE",
    "media": { "kind": "video", "source": "short.mp4" }
  }
}
```

A lead-form variant: `"objective": "OUTCOME_LEADS"`, `"optimizationGoal":
"LEAD_GENERATION"`, and in `creative`: `"leadForm": { "name": "founders",
"privacyUrl": "https://wrenautomation.com/privacy" }` (or `{ "id": "…" }`
for one that exists). The CTA then opens the instant form.

## Launch, start, stop

```sh
pnpm wren ads launch ads/founders.json
# campaign 1203…   adset 1203…   creative 1203…   ad 1203…
# PAUSED · $20/day once started:
#   wren ads start 1203… 1203… 1203… --daily 20
pnpm wren ads start <campaignId> <adsetId> <adId> --daily 20   # three ACTIVE writes; the box asks you for the first
pnpm wren ads stop <campaignId>
```

`launch` makes campaign → ad set → creative → ad, all PAUSED, as one
journaled ladder (a retry resumes after the last object made). `start` is
the only command that spends: the ad set goes ACTIVE with its budget (the
gate's amount), then the campaign, then the ad. Local media uploads to
`WREN_MEDIA_BUCKET` first.

## Watch

```sh
pnpm wren ads launches                    # the ad_launches ledger
pnpm wren ads insights --preset last_7d [--level adset]
pnpm wren ads watch start|status|sync     # AdsWatch/default (running on prod)
```

The guard: once a day, adset-level insights for the last 7 days; an active
launch that spent `WREN_ADS_PAUSE_AFTER_USD` (default $50) with zero clicks
and zero results is stopped through `Ads.stop`, the row says why, and the
channel gets one message per pass. One click or one result keeps it on —
you read the numbers.

## Ads ↔ posts

```sh
pnpm wren content ideas                        # a winning ad shows up here as an open idea (source ads), once
pnpm wren content draft <ideaId>               # draft it when you want it
pnpm wren ads spec-from <draftId> --out ads/post.json --daily 10 --countries US,CA   # a post that worked → a spec
pnpm wren ads launch ads/post.json             # PAUSED, as always
```
A winner = a result, or ten clicks, and not paused.

## Leads

```sh
pnpm wren ads lead-form founders https://wrenautomation.com/privacy --thanks https://wrenautomation.com/thanks
pnpm wren ads lead-forms
pnpm wren ads leads <formId> --limit 50   # created  email=…  full_name=…
```

Reading leads needs `leads_retrieval` from Meta app review. Until then the
CTA-to-lander path is the one that works.

Design: `../designs/2026-09-22-meta-ads.md`.

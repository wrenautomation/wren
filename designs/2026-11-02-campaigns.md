# Campaigns: a group on the metro map

2026-11-02. William: make the campaign a primitive, and use the metro map (he calls it orrery for now) to see it and to target and organise funnels and media. Product: `designs/2026-11-02-starling.md`.

## Target

A campaign is one offer, one audience and one CTA ladder, run on any channels with set accounts and caps. Every post, comment, invite, DM, email and text it makes carries its id. Top-of-funnel and bottom-of-funnel YouTube are two campaigns on one account. "Free guide → newsletter" is a campaign. A cold email plus LinkedIn push to one niche is a campaign.

On the map, a campaign is a group. It folds to one circle with its numbers and opens to its stations.

## Today

- "Campaign" is a text field on an out line's entry (`LineEntry.campaign`, `pipeline/src/metro.ts`). It is used only to match a cause and to join Meta's ad spend (`pipeline/src/views.ts`). It is also a `/go/` link word. The email worker's `Campaign`, a Meta campaign and an SMS 10DLC registration are other things.
- Content and reach loops run on global settings. No loop knows of a campaign.
- `MetroGroup` (`metro.ts`) has id, label, line, stations, parent and attach. Groups nest to any depth and fold (`designs/2026-10-23-metro-fold-tree.md`).
- The map already has `race`, `split` and `join` stations (`rule`: all, any, n of m), tracks with `wait` (the clock branch of a race) and A/B weights. The runtime refuses them all: `lowerable` (`pipeline/src/convert.ts`) says "the runtime does not run it yet".
- Shape versions are append-only, with diff, blame and merge (`metro-diff.ts`, `metro-blame.ts`, `metro-merge.ts`).

## Options

| | How | For | Against |
|---|---|---|---|
| **A. A group on the metro map (chosen)** | A group with campaign fields | One engine. The map already draws, folds, counts, versions, diffs and merges it. | Each campaign edit is a new shape version. A station sits in one campaign only. |
| B. A versioned row that owns lines | `pipeline.campaign_versions` | Campaign edits stay apart from the shape | Two homes for one idea. The map must join to draw it. |
| C. One map per campaign | A shape per campaign | Campaigns fully apart | No single business view. Offers and plans repeat. |

Ranked by: one workflow engine (the 10-25 rule), then true numbers per campaign, then one place to see the business, then clients apart.

## The model

`MetroGroup` gets `campaign?: CampaignFields`:

| Field | What |
|---|---|
| `offer` | the registry offer its CTAs sell |
| `audience` | a segment id, or the out lines that feed it |
| `ctas` | the ladder: an ordered list of `{ label, station }`, each a station inside the group whose action is `cta`, `form`, `visit` or `book` |
| `accounts` | per platform, the account that acts |
| `caps` | per `<platform>.<act>` per day (`linkedin.comment: 20`), under the platform caps |
| `from`, `until` | dates. None: open-ended |
| `status` | `live`, `paused` or `ended` |

Every field is optional on the group. `status` resolves to `live` when no campaign above it sets one.

Rules:
- The id is the group id. Ids never change across versions, so numbers join across versions.
- A campaign may sit inside a campaign. A field left unset comes from the nearest campaign above it.
- Offer and plan stations that many campaigns share sit outside campaign groups.
- `LineEntry.campaign` becomes a ref to a campaign group. A `/go/<channel>/<campaign>/<content>` link uses the group id.
- One person may be in many campaigns at once: they watch top-of-funnel and bottom-of-funnel content. Each touch carries one campaign, so each campaign's numbers stay true. A reply on a race in one campaign stops only that campaign's other branches.
- A lead magnet needs no new station kind: a `form` station with a `page` attach (the free thing) and a track to the newsletter line. A newsletter is a line with a lap ("every 7 days").

## Phases

1. **Model.** Add `campaign` to `MetroGroup`, with its check rules and its form in the metro file. Add `wren campaigns` (list, show). Each workspace gets one default campaign that holds today's global settings, so no loop stops.
   - The default campaign is computed, not stored: id `default`, every station outside a campaign group, status `live`, fields unset (a loop reads its settings as today). No shape needs a new version, and a group may not take the id `default`.
   - `LineEntry.campaign` stays text: the `utm_campaign` word an ads or `/go/` source matches. It moves to group ids with `/go/` links in phase 3, and the Meta spend join when ads start.
2. **Numbers from the journeys.** `wren campaigns numbers [--window]`: per campaign, people in, converted (reached a CTA station), open now, deals (`campaign-numbers.ts`). A journey is in a campaign when it arrived at a station of it, on the version it was on then. A parent counts its children.
3. **Loops take a campaign, and stamp it.** A `campaign` column on touches, `content_drafts`, `reach_posts`, `reach_messages`, email `messages` and `sms_messages`, null for the default. Each loop writes it as it learns the campaign: the content planner plans per campaign (platforms, cadence, CTA), reach passes pick from the campaign's audience with its accounts and caps, cold email enrolls into a campaign, newsletters run as a campaign's lap. `/go/` links carry the group id. Acts and cost join the numbers.
4. **Logic in the runtime.** The executor runs `split` (fan-out), `join` (all, any, n of m) and `race` (first event wins, the other branches stop). A campaign on many channels needs race: a reply on one channel stops the rest.
5. **The map.** A campaign circle shows its fields and numbers. It is edited in the portal and in the metro file.

Numbers come before control. The journey numbers show what to change before loops depend on campaigns.

## Caps

Two levels. The global cap per account and platform guards against a bot flag; no act passes it. A campaign cap is a second, smaller limit inside it. Campaigns take from the global cap first come, first served. When campaigns compete for many accounts, phase 3 sets how they split.

## Phase 3: how a loop learns its campaign (proposed, needs William)

Today each loop runs one pass on global settings: the content planner, the reach passes (follows, comments, invites, DMs), cold email enrollment, SMS. Global caps sit in several places: `limits` rows (`outbound/src/limits.ts`, ramped), the reach policy (`policy.ts`), and autobrowse's own caps on the Mac.

| | How | For | Against |
|---|---|---|---|
| **A. One pass walks the campaigns (recommended)** | Each pass reads the live campaigns, in body order, the default last. Per campaign: its audience, accounts and caps. Every act stamps the campaign it ran for | First come, first served is body order, the same every pass. The global count is read once per pass. The default campaign is today's pass, unchanged. One Restate key per loop, as today | A slow campaign delays the ones after it in the same pass |
| B. One loop per campaign | A Restate key per campaign id | Campaigns run apart, in parallel | The global cap becomes a shared counter across keys: a race on every act, the bot-flag guard at risk |
| C. A campaign is a filter on today's pass | The pass picks targets as today, then gives each to the first campaign whose audience takes it | Least change | The content planner cannot plan per campaign: a filter has no cadence or CTA |

Ranked by: the global cap holds (the bot-flag guard), then numbers per campaign stay true, then least new runtime.

The cap check is one function for every loop: what is left = the smaller of the global cap left and the campaign cap left. The global count reads every act on the account and platform; the campaign count reads the acts stamped with that campaign. The global caps stay where they are. A campaign cap never raises one.

Build order: the `campaign` column and its writer go in together, loop by loop, fewest writers first: cold email enroll, then reach passes, then the content planner, then SMS.

## Decision log

- 2026-11-02: a campaign is a group on the metro map, option A (William: "i agree that a campaign is a group in orrery"). A row alone (B) was my first pick; William was "not sure about just having a versioned row".
- 2026-11-02: no campaign or lead-magnet station kind; a campaign is a group, and a journey runs over many stations (William). One person may be in many campaigns at once (William: "they could be consuming top of funnel and bottom of funnel content").
- 2026-11-02, phase 1 build (WA-999):
  - `campaign` merges as one field. Both sides changed it is a conflict. A per-key merge could interleave two CTA ladders into an order nobody wrote.
  - `accounts` and `caps` inherit per key: a child sets one account or one cap and keeps the rest. Other fields inherit whole.
  - A stricter parent status wins: a paused or ended parent holds a live child. A child cap may not exceed its parent's.
  - Account and cap channels are the site platforms plus `email` and `sms` (`CAMPAIGN_CHANNELS`, typed against `Platform`, so a new platform must be added).
  - The act in a cap key is a free slug (`linkedin.comment`). Acts per platform are not one closed list yet; phase 3 checks them against the loop that spends them.
  - A CTA station may sit in a group below the campaign, never above it.
  - The default campaign is computed by `campaignsOf`, never stored.
- 2026-11-02: caps have two levels, global and per campaign; they do not conflict. First come, first served under the global cap for now. William: "doesn't matter how we do it as long as we just avoid getting bot flagged". The global caps hold in every phase.
- 2026-11-02, phase 2 re-plan (WA-999): no act writer knows its station. The 27 writers of the six act tables run on global settings, and no loop knows a campaign. So "each act stamps the campaign of its station" has no source until phase 3. Options:

  | | How | For | Against |
  |---|---|---|---|
  | **A. Journey numbers now, the stamp with its writers in phase 3 (chosen)** | Phase 2 reads the journeys. Phase 3 adds the column and its writer together | No column that nobody writes. Real numbers now | Acts and cost per campaign wait for phase 3 |
  | B. Columns on six tables now, null | The design as written | The schema is ready | Every row null until phase 3: a stale path |
  | C. Stamp `touches`, `messages`, `sms_messages` only | `touches` mirrors the reach rows by `ref` | 11 writers, not 27 | Our posts are not touches. Still null until phase 3 |

  Ranked by: true numbers, then no stale paths, then fewest writers. In every option the column is null for the default, so no backfill. William may still pick B.

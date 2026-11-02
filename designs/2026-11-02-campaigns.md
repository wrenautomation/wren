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
3. **Loops take a campaign, and stamp it.** A `campaign` column at the level each loop enrolls or queues, null for the default: email `enrollments`, `reach_contacts`, `reach_posts`, `content_ideas`, `sms_contacts`. Messages, invites, DMs, likes, follows and touches inherit it through their parent row. Each loop writes it as it learns the campaign: the content planner plans per campaign (platforms, cadence, CTA), reach passes pick from the campaign's audience with its accounts and caps, cold email enrolls into a campaign, newsletters run as a campaign's lap. `/go/` links carry the group id. Acts and cost join the numbers.
4. **Logic in the runtime.** The executor runs `split` (fan-out), `join` (all, any, n of m) and `race` (first event wins, the other branches stop). A campaign on many channels needs race: a reply on one channel stops the rest.
5. **The map.** A campaign circle shows its fields and numbers. It is edited in the portal and in the metro file.

Numbers come before control. The journey numbers show what to change before loops depend on campaigns.

## Caps

Two levels. The global cap per account and platform guards against a bot flag; no act passes it. A campaign cap is a second, smaller limit inside it. Campaigns take from the global cap first come, first served. When campaigns compete for many accounts, phase 3 sets how they split.

## Phase 3: how a loop learns its campaign

Today each loop runs one pass on global settings: the content planner, the reach passes (follows, comments, invites, DMs), cold email enrollment, SMS. Global caps sit in several places: `limits` rows (`outbound/src/limits.ts`, ramped), the reach policy (`policy.ts`), and autobrowse's own caps on the Mac.

| | How | For | Against |
|---|---|---|---|
| **A. One pass walks the campaigns (chosen)** | Each pass reads the live campaigns, in body order, the default last. Per campaign: its audience, accounts and caps. Every act stamps the campaign it ran for | First come, first served is body order, the same every pass. The global count is read once per pass. The default campaign is today's pass, unchanged. One Restate key per loop, as today | A slow campaign delays the ones after it in the same pass |
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
- 2026-11-02: phase 2 re-plan option A and phase 3 option A (William: "A, A go"). The act stamp lands with its writer in phase 3; each loop pass walks the live campaigns in body order, the default last.
- 2026-11-02, phase 3 cold email (WA-999):
  - The stamp is `enrollments.campaign`, not a `messages` column. Messages inherit it through `enrollment_id`, so the three message writers stay as they are.
  - A campaign joins a niche's pass when its `accounts.email` is one of the niche's senders. It sends from that inbox only. No email account: no cold email.
  - Its `offer` picks the plan rules that pitch it. No offer: every rule.
  - Its segment gates the person pass by the `person` profile key. Role inboxes sit out: they have no profile. A `lines` audience does not narrow cold email yet.
  - Cap `email.opener`: openers a day. The queue holds `daysAhead` days, so campaign left = cap × days − its queued openers, inside the global shortfall (`capLeft`). `CAMPAIGN_ACTS` lists the email acts; a check refuses others.
  - One active enrollment per company, person and address: a company sits in one email campaign at a time, the first in body order.
  - From and until use the UTC day.
  - The shape sits above the channels (`scripts/layers-guard.mjs`). `LoopCampaign` and `capLeft` sit in `@wren/starling-core/campaigns`; the worker passes `liveCampaignsOf`.
  - `exhausted` means the default sweep found nobody. A dry campaign is not a dry pool.
- 2026-11-02, phase 3 reach (WA-999):
  - Invites: the stamp is `reach_contacts.campaign`, set at enroll. The invite, the DMs after it and their touches inherit it through `contact_id` and `ref`.
  - Comments: the stamp is `reach_posts.campaign`, set when the draft is queued. The like and follow on that post inherit it. A follow from People has no post: it stays the default.
  - A campaign joins a pass when its `accounts.<platform>` is the pass's account (any case).
  - Caps: `linkedin.invite` counts the campaign's invites queued or proposed, the same as the top-up's day target. `<platform>.comment` counts its comments queued in the last 24 hours, the same as `perDay`. Both sit inside the global left (`capLeft`).
  - `CAMPAIGN_ACTS` refuses a cap on `linkedin.follow` or `linkedin.message`: follows inherit a comment's campaign, and DMs are his click.
  - Segment: invites by the person (`p.id`); comments by the post's author, through `social_handles.person_id`. Most authors are not in People, so a segment comment campaign often drafts nothing. Engaged strangers sit out a segment campaign: they have no profile.
  - A `lines` audience does not narrow reach yet. Reads (searches, pages) stay global; only the drafting walks the campaigns.
  - Reddit is out: its accounts are warming.
  - `liveCampaigns` returns the campaigns only, never the default. Each loop adds its own default sweep last (`sweepsOn`, `campaignSweeps`).
- 2026-11-02, phase 3 content (WA-999). Where the stamp sits:

  | | How | For | Against |
  |---|---|---|---|
  | **A. `content_ideas.campaign` (chosen)** | A person or the API tags an idea. A campaign sweep drafts only its own open ideas; the default drafts untagged ideas, questions and chapters. Drafts inherit through `idea_id`, so a redraft keeps it | The words are written for the campaign, so its numbers are its own posts | A campaign with no tagged ideas drafts nothing |
  | B. `content_drafts.campaign`, ideas shared | The sweep takes the next idea of any kind and stamps the draft | Every campaign fills its slots | A random idea counts as the campaign's post: its numbers are noise |
  | C. Both columns | Idea tag, draft stamp | Shows a shared idea used per campaign | Two columns to keep equal; no reader needs the difference |

  Ranked by: true numbers per campaign, then no second column, then fill rate. The design's `content_drafts` column becomes the idea's: one level up, as messages inherit from an enrollment.
  - A campaign joins the planner on a platform when its `accounts.<platform>` is set. Its drafts post as that account (`draft_accounts`, `pickAccount`): an account that is not ours on that platform is said and skipped, and the draft posts as the default. A client key reads its own shape; its drafts post as its own login, so the pick is not written.
  - Cap `<platform>.post`: the campaign's drafts that hold a slot in tomorrow (draft, approved, publishing, published), inside the day's open slots (`capLeft`).
  - Ideas of a campaign that is not live wait. The default never drafts them.
  - `--campaign` on `wren content add` and `wren write` checks the id against the newest shape. The desk's API takes it as given.
  - Deferred: the CTA in the prompt and `pointsTo` from the campaign's CTA ladder; the offer in the prompt.
  - `/go/` links stay `/go/<channel>/<stage>/<draft8>` (`inbound/src/funnel.ts`). The draft joins its idea, and the idea its campaign, so a click finds its campaign without a new path. `LineEntry.campaign` stays a `utm_campaign` word until ads start.
- 2026-11-02, phase 3 SMS (WA-999). No cold SMS pass runs: `enroll` has 3 callers, the form follow-up and speed to lead (named applicants) and the operator's `wren sms enroll`. `SmsWatch` enrolls no one. So "each pass walks the campaigns" has no pass here.

  | | How | For | Against |
  |---|---|---|---|
  | **A. `--campaign` on the manual enroll (chosen)** | `wren sms enroll --campaign <id>`. The handler finds the live campaign and enrolls only its segment's people, under `sms.opener` | Fits how SMS runs today. One writer | The operator names the campaign; nothing sweeps |
  | B. The enroll sweeps the live campaigns, default last | The `limit` is split across campaigns with `accounts.sms` | The same as the other loops | `accounts.sms` has no meaning: SMS has one number pool and one profile, not per-campaign senders |
  | C. A cold pass in `SmsWatch` | A new pass sweeps as `ComposeScheduler` does | Campaigns run themselves | Turns a manual channel automatic. Cold SMS has never sent in prod. Spend is William's call |

  Ranked by: no new sends without William's yes, then one writer, then the same shape as the other loops. A sweep comes with a cold pass, if one is built.
  - The stamp is `sms_contacts.campaign`, written in the same update that enrolls. A contact enrolls once (`new` to `enrolled`, never back), so this is the enrollment level. Messages inherit through `contact_id`. Form and speed enrollments stay the default.
  - Segment: people only (`personInSegment` on `person_id`), as cold email. A contact with no person sits out.
  - Cap `sms.opener`: the campaign's contacts enrolled in this fleet day (Eastern, as the pool's caps), inside the `limit` (`capLeft`). The pool's send caps still pace delivery.
  - `accounts.sms` is not read. Deferred: the offer (an SMS sequence has none) and a sticky number per campaign.
- 2026-11-02, phase 3 numbers (WA-999). The stamps are in, so acts join `wren campaigns numbers`.
  - Acts use the cap words (`<channel>.<act>`), so a cap and its spend read side by side. Each counts a done act in the window, by its own time: `email.opener` (step 1 sent), `linkedin.invite` (the connect sent), `<platform>.comment` (`commented_at`), `<platform>.post` (`published_at`, through the idea), `sms.opener` (step 1 sent). A parent counts its children's acts.
  - Follow-ups, DMs, likes and follows inherit a stamp but have no cap word. They wait until a reader needs them.
  - Cost waits. Only a text has a cost per act (`sms_messages.cost_usd`). Inboxes, seats and models are paid per account or per month, so a campaign's share is a split rule. That rule is William's call.
- 2026-11-02, phase 4 options (WA-999). Waits on William's pick.
  - Today a person has one open journey (`uq_instances_open_person`, plus the profile lock) at one node (`instances.node`). A cause at a station pulls the journey along a path to it (`journey.move`, `pathOf`). Split and join need a journey at many stations at once. A person in two campaigns needs the same. So one mechanism serves both.
  - Prod: shape v8 has no logic stations and no campaigns; 22 journeys are open. No data to carry.

  | | How | For | Against |
  |---|---|---|---|
  | **A. Branches on the one row (recommended)** | `instances.branches` jsonb: `{key, node, status}`. A key is a split track id, or a campaign id for a second campaign. `node` stays the front, for the board. Each crossing carries its branch key | One open row per person stays, so the profile lock still orders every move. Numbers read events per journey: no change. Board, segments and the `mine` view keep reading `node` | About 25 files read `node` or `trail`. Each that means "where is the person" must pick the front or a branch. No index on a branch node (GIN later, if a read needs it) |
  | B. A child row per branch | `instances.parent`. A split opens a child per track; a join closes them and moves the parent | `journey.move` runs per row, unchanged | Breaks one open journey per person: the lock and the unique index move to the root. Numbers, board and segments must roll children up, or a person counts twice |
  | C. A position table | `journey_positions(instance, key, node, trail, status)`; `instances.node` derived | Indexed "who is at X" | A second home for a position; two writes a move; the reader changes of A plus a join |
  | D. A workflow engine for logic (BPMN) | Lower logic stations to a BPMN engine | Split, join and race come built | A second engine beside the executor. Restate already gives durable timers |

  - Ranked by: one home for a person's state (the lock holds, numbers stay true), then no second engine, then fewest readers to change.
  - The logic runs in `journey.move`, the pull model. Stations are observed; loops do the acts. So a split opens no branch until a cause arrives on its track.
    - Split: a cause at a station past a split opens that track's branch. The other tracks stay open to the next cause.
    - Join: an arrival marks its branch. When the rule (all, any, n of m) is met, the branches close and the journey moves to the join.
    - Race: the first branch to arrive wins. The wait arm is a timed hold on the executor (`due` + `Executor/release`), set on arrival at the race. The release moves the journey down the wait arm if nothing won first.
    - A race won by an event stops the campaign's other acts for that person. The move calls `stopCampaign` (see the phase 4 rules). Each loop stops the person's rows stamped with it: the email enrollment, the reach contact, the SMS contact. This is "a reply on one channel stops the rest".
  - A race `cond` is free text today, and no event matches it. Recommended: a cond must be an until word (`reply`, `booking`, `answer`, `cancelled`, `logic.ts` `UNTILS`); `checkMetro` refuses others.
  - `condition` and `ab` stay refused by `lowerable`. `graphOf` of a body with no logic station stays the same, node for node (Restate replays `shape.v<n>` in that order).
- 2026-11-02, phase 4 decision (WA-999). William: "not sure about branches, your call ... as long as you cleanly map your solution to common realistic business cases". Chosen: A, branches on the one row. A race arm is won by the trigger of the station it leads to, not by fixed words.
  - Why not fixed words (`UNTILS`): real races also wait on a payment, a signature or a form. The station after an arm already names its trigger, so the cond stays a label. `lowerable` refuses an arm whose station has no trigger.
  - The cases, and how each runs:

  | Case | Shape | How it runs |
  |---|---|---|
  | Proposal follow-up | `proposal sent` → race: `replied` (trigger.reply) or wait 3d → `follow-up` | Arrival at `proposal sent` sets the clock. A reply first: the journey moves to `replied`, and the campaign's other acts for this person stop. No reply in 3 days: the clock moves it to `follow-up` |
  | Multichannel outreach | Loops send on email, LinkedIn and SMS for the campaign; `contacted` → race: `replied` or wait 14d → `nurture` | The loops do the channels, not a split. A reply on any channel wins the race and stops the campaign's email sequence, reach contact and SMS contact for this person |
  | Invoice reminder | `invoice sent` → race: `paid` (trigger.payment) or wait 7d → `reminder` | Same as the follow-up, with a payment as the event |
  | Onboarding | `won` → split: `contract signed`, `paid`, `intake form` → join all → `kickoff` | Each event opens its own branch, in any order. `kickoff` moves only when all three are in. A kickoff booked early is refused, unless moved by hand |
  | Sales-ready | `lead` → split: `guide read`, `webinar attended`, `pricing visited` → join 2 of 3 → `call offered` | The second signal meets the rule. The third branch closes |
  | Two campaigns | A guide campaign and a webinar campaign, each with its own entry | A person in the guide campaign who signs up for the webinar gets a second branch, keyed by the webinar campaign. Each campaign's numbers count them |

  - Rules:
    - A branch is `{key, node}`. No branches stored means one branch at `node`, so open journeys carry over as they are. `node` is the front: the branch that moved last. The board, segments and the `mine` view read it.
    - A cause at a station moves the nearest branch that has a legal path to it. A path may cross a split on any track no other branch took. The other tracks wait at the split as their own branches.
    - A branch at the station before a join counts as in. A path through a join passes only when the rule is met. Then the join's branches close into one, and so does every other branch that can reach the join. Reach honours the pin: a branch waiting at a split leaves only by its own track, so an inner join never closes an outer split's branch.
    - A path through a race takes a cond arm by a cause, or the wait arm by the clock only. The clock is a wire wait on the executor (`wire.wait`), set on arrival at the station before the race. A clock that fires after the branch moved on does nothing. The clock event has its own subject (`race:<journey>:<gate>`, so the executor's hold never blocks a real move), names its branch, and never opens a journey.
    - A cause at a station no branch can reach opens a new branch there, only when the station is in a campaign that holds no branch and a source into it takes the cause. Else it is refused, as today.
    - Any cause that pulls through a cond arm wins it, also one at a station past the arm's own.
    - A station with a track into a logic station has no other track out, but a back track. No track runs logic to logic. No logic on a content line.
    - A race won by an event calls `stopCampaign(person, campaign)`. The worker wires it to each loop: it ends the person's email enrollment, reach contact and SMS contact stamped with that campaign (null for the default). A race in the default campaign stops the default rows too: a person who replied or paid gets no more cold acts.
    - Built (slice 5): `stopCampaign` runs in the move's transaction, so a retried step never loses it. The worker (`apps/worker/src/campaign-stop.ts`) finds the person by profile keys (email, phone, `handle:<platform>`, `person`) and calls one stop per channel:
      - Email: `stopCampaignEnrollments` stops active enrollments. Reason by the winning cause: a reply is `reply`, a booking is `booked`, else `manual`. No new stop reason, so no migration.
      - Reach: `stopCampaignContacts` sets live contacts to `finished` with the why. Queued or proposed connect, sequence and follow-up DMs skip, also for a contact whose sequence already finished. An operator's own message stays.
      - SMS: `stopCampaignTexts` sets new and enrolled contacts to `finished`, not `stopped`: `stopped` would also block answers, reminders and review asks. Queued sequence and follow-up texts skip.
    - Only a cause that crosses a cond arm wins. A forced hand move (with a reason) wins nothing, so it stops nothing: the operator chose the station, not the race. A hand move with no reason to the arm's station wins it, with reason `manual`.
    - Built (slice 4): arrival at the station before a race emits on `armed` with subject `race:<journey>:<gate>`. The cause is `clock`. A clock that finds its branch moved on, or the journey closed, does nothing.
    - A publish carries each branch whose node is in the new version. A branch on a node or gate the new version lacks refuses the publish, as a missing node does today.
    - `now` in the numbers counts the front only. A person with branches in two campaigns shows as now in one. Accepted until a reader needs both.
    - Gates never show as arrivals: `skipped` and stage events leave them out.

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-02 @ e0b27ae3 + WA-999 phase 3 (cold email, reach, content and SMS read campaigns)
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
- Loops (phase 3): `liveCampaigns(body, day)` (`metro-campaigns.ts`): live, inside its UTC dates, body order, never the default (each loop adds its own default sweep last); `liveCampaignsOf(db, now)` (`store.ts`) on the newest shape. A channel sits below the shape, so a loop reads `LoopCampaign` and the cap function `capLeft` (smaller of global left and campaign left) from `@wren/starling-core/campaigns`; the worker passes the live campaigns in. `CAMPAIGN_ACTS` lists the acts a loop spends (`email.opener`, `linkedin.invite`, `<platform>.comment` for the reach post platforms, `<platform>.post` for every content platform, `sms.opener`); a cap on another act of a listed channel is refused. `sweepsOn` (`@wren/starling-core/campaigns`) gives a reach loop its sweeps: the campaigns on that account, then the default.
- Cold email: `campaignSweeps` (`compose-scheduler.ts`). A campaign whose `accounts.email` is a niche sender composes from that inbox, its offer's plan rules, its segment's people (person pass only), under its `email.opener` cap, before the default. It stamps `enrollments.campaign` ([[email/enrollment]]).
- Reach: invites (`topUp`) stamp `reach_contacts.campaign` ([[content/linkedin-invite]]); comments (`postsPass`) stamp `reach_posts.campaign` ([[content/reach-post]]). DMs, likes, follows and touches inherit. The segment gate is `personInSegment` (`@wren/core/segments`), shared with cold email.
- Content: the stamp is `content_ideas.campaign` ([[content/idea]]); drafts inherit it through `idea_id`. `PostPlan` (`restate/planner.ts`) sweeps each live campaign first: its own ideas only, on platforms where `accounts.<platform>` is set, under `<platform>.post` (`campaignSlots`, `plan.ts`). Its drafts post as that account (`draft_accounts`). Ideas of a campaign that is not live wait. The audience does not narrow content. Process: [[processes/content-loop]].
- SMS: no cold SMS pass runs, so nothing sweeps. `wren sms enroll --campaign <id>` (`SmsDesk.enroll`) finds the live campaign, enrolls only its segment's people under `sms.opener` (contacts enrolled this fleet day, Eastern), and stamps `sms_contacts.campaign` ([[sms/sms-contact]]). Texts inherit through `contact_id`. Form and speed enrollments stay the default. `accounts.sms` is not read.
- Numbers: `campaignNumbers` (`campaign-numbers.ts`) per campaign: people in, converted (reached a CTA), open now, deals. Read off journey arrivals, each on the version it was on, so ids join across versions. A journey a new version carried counts for deals, not as a person in. A parent counts its children; a person in two campaigns counts in both. Acts (`actsOf`): done acts in the window by stamp, keyed by cap word (`email.opener`, `<platform>.invite`, `<platform>.comment`, `<platform>.post`, `sms.opener`), each at its own time. No stamp counts in the default. Cost waits on a split rule (William's call).

Citations: `packages/pipeline/src/metro-campaigns.ts:146`, `packages/starling/core/src/campaigns.ts`, `packages/starling/outbound/src/email/restate/compose-scheduler.ts`, `packages/starling/outbound/src/invites.ts`, `packages/starling/outbound/src/reach-posts/pass.ts`, `packages/starling/inbound/src/restate/planner.ts`, `packages/starling/channels/sms/src/enroll.ts`, `packages/pipeline/src/metro.ts`, `packages/pipeline/src/campaign-numbers.ts`, `apps/cli/src/campaigns.ts`

## Connected to

- **is:** a [[platform/shape]] group
- **joins:** an offer of the registry; a [[leads/segment]]; `LineEntry.campaign` stays text (a `utm_campaign` word) until phase 3
- **not:** the email worker's `Campaign` (`compose-scheduler.ts:39`, a niche send plan), a Meta campaign, an SMS 10DLC registration

## If you change this

- **Hits:** `checkMetro` (every shape save, import and draft), the metro file schema, `wren campaigns`; the cold email top-up (`EmailOpenerFill`, each pass); the invite top-up and the comment drafting (`ReachInboxRead`, each pass); the content planner's fill (`PostPlan`, each pass); the SMS enroll (`SmsDesk.enroll` with a campaign)
- **Does not hit:** form and speed SMS enrollments; content publishing and metrics; reach reads; the runtime; the map UI (phase 5)

## Surfaces

| Surface | Role |
|---|---|
| `wren campaigns list\|show\|numbers` | reads |
| `wren shape` export/import, draft `set` op | writes |
| `EmailOpenerFill/<niche>` | reads (live campaigns, each pass) |
| `ReachInboxRead/daily` | reads (live campaigns, the invites and posts passes) |
| `PostPlan/<key>` | reads (live campaigns of its database, each fill) |
| `wren content add --campaign`, `wren write --campaign` | writes (an idea's campaign) |
| `SmsDesk/enroll`, `wren sms enroll --campaign` | reads (one live campaign), writes (a contact's campaign) |

## See

- Source: `packages/pipeline/src/metro-campaigns.ts`, `packages/pipeline/src/campaign-numbers.ts`, `apps/cli/src/campaigns.ts`

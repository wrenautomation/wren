# Push everywhere

2026-10-12. William: "webhooks wherever possible", a fake webhook where a platform has none (an
idle tab that waits for a change), and replies that run up to the approval and go out the moment
it comes. Builds on `designs/2026-10-11-push-not-poll.md`: an event wakes the loop, a slow poll
stays as the net.

## What each platform pushes

| Platform | Push | What it takes | Here |
|---|---|---|---|
| Facebook Page | Webhooks, `page` object: `feed` (comments), `messages` | App Live; a Page subscribed (`/{page}/subscribed_apps`); our own Page needs no review, a client's needs Advanced Access | build now |
| Instagram | Webhooks, `instagram` object: `messages`; `comments` | `messages` like the Page; `comments` needs Advanced Access (App Review) for anyone, us included | build now; comments wake on review |
| Google Business Profile | Pub/Sub, `NEW_REVIEW`, `UPDATED_REVIEW` per account | GBP API access (not filed) | build, off until access |
| LinkedIn | Webhooks, organization social actions | Community Management API, Standard tier; the Development tier disables them | tab watcher now; webhook after the tier |
| X | Activity API webhooks, pay per event ($0.005 a reply, $0.01 a DM) | credits: William's money call | tab watcher now |
| YouTube | WebSub: new uploads only, no comments | none | not now: nothing waits on our own uploads |
| TikTok | Webhooks: publish status, revoked access; no comments | callback URL on the app | not now: a post's status is read once after publish |
| Reddit | none | | tab watcher |

Sources: Meta's Instagram Platform webhooks page ("Advanced Access is required to receive
comments", "your app must be published"), LinkedIn's Community Management migration guide
("disables webhooks for social actions during the development tier"), X's pricing page.

## One door per vendor, one wake per owner

```
Meta ──POST /webhooks/meta──┐
GBP Pub/Sub ─/webhooks/gbp──┤ phone Worker: signature, then
autobrowse watcher ─────────┤ SocialPush/{meta,gbp,watch} (event digest = idempotency key)
                            ▼
              SocialPushed/<owner>: keeps what was pushed, wakes SocialWatch/<owner key>
                            ▼
              SocialWatch pass: reads the pushed posts and inboxes first, due or not
```

- `/webhooks/meta`: GET answers Meta's `hub.challenge` when `hub.verify_token` matches
  `META_WEBHOOK_TOKEN`. POST checks `X-Hub-Signature-256` against the app secret
  (`META_APP_SECRET`) or the Instagram app's (`INSTAGRAM_APP_SECRET`), then sends the body to
  `SocialPush/meta` keyed by its digest. Meta batches several entries per body.
- `SocialPush` (service) maps each entry to an owner: our Page or Instagram id
  (`WREN_META_PAGE_ID`, `WREN_META_IG_ID`) is `wren`; otherwise the `social_connections` row
  whose `external_id` (or `extra.pageId`) it names. An unknown id is dropped and counted.
- `SocialPushed/<owner>` (object) `add([{platform, kind, post?}])`: adds to its pending set, then
  `SocialWatch/<key>/wake` (and `ReachWatch/daily/wake` for our own DMs). `take()` hands the
  set to the pass and clears it.
- The pass, first: each pushed post's comments (due or not), a pushed DM's inbox
  (`SocialInbox.read` for a client, the reach inbox for us), a pushed review's platform. Then
  the usual pass. One webhook or many in a burst: one pass.
- Outside 07:00 to 23:00 a push still wakes the pass. A comment at 23:30 waits for no clock.

## Subscribing

- `wren social push meta` (CLI): sets the app's `page` and `instagram` subscriptions
  (autobrowse `meta` `POST /app/subscriptions`: app token, our callback, `META_WEBHOOK_TOKEN`),
  then subscribes our Page (`POST /{page}/subscribed_apps`, `feed,messages`). Idempotent.
  `--check` only reads.
- A client's Meta connect (`connect/oauth.ts`) subscribes its Page the same way. Before App
  Review nothing arrives for it; its 30-minute pass is the net as today.
- `wren social push gbp`: Pub/Sub topic `gbp-push` in `wrenautomation`, publisher
  `mybusiness-api-pubsub@system.gserviceaccount.com`, push to `/webhooks/gbp?token=`; each
  connected Profile's account gets `notificationSetting` with `NEW_REVIEW,UPDATED_REVIEW`.

## Tab watchers (autobrowse)

For a platform with no push we can use, autobrowse keeps one tab open as the account on a page
that marks nothing read, and reads the unread count in the tab's title (`(3) Feed | LinkedIn`),
which the site's own live channel keeps current. Design and memory bounds: autobrowse
`designs/2026-10-12-watchers-and-arming.md`.

- Each `SocialWatch/wren` pass sends `desk/watch` per watched login (`watched` in the worker:
  `linkedin@wren`, `x@wren`) with sink `/SocialPush/watch/send` and a lease to 45 minutes past the
  next pass. A loop that stops leaves no tab.
- A rise in the count sends `SocialPush/watch({owner, platform, kind: "activity"})`: an activity
  and a DM push for that platform. `SocialWatch` reads its activity now; `ReachWatch` reads that
  platform's accounts now (`SocialPushed.reach`), due or not.
- Every 10 minutes a signed-in watcher sends `kind: "alive"`. While one beat in the last 25
  minutes (`WATCH_ALIVE_MS`), ReachWatch reads that platform cold (30 minutes) instead of every 2
  after a touch. A signed-out tab never beats, so polling comes back on its own.

## Replies armed before the yes

A reply waiting in To approve gets its browser leg run up to the last step: the post open, the
reply box found. On approve, only the typing and the click remain.

- `InboxDesk.ask` on a Wren comment sends `ReachDesk.armComment`. On our own post it calls
  `Content.arm`, which runs the channel's `reply` over an arming sites client
  (`restateSites({arm})`): reads run, the first write goes to `sites/arm` instead, and
  `ArmedStop` ends the channel there. One code path builds the write for both.
- autobrowse keeps the armed tab under the call's path and target (typed words left out). The
  approve call is unchanged: the same path on the same browser takes the tab. A lapsed arm (20
  minutes, a restart, the tab died) runs the whole flow. Same result either way.
- An API leg answers `{armed: null}`: nothing to warm, and it is already fast.
- The portal's Approve is `optimistic`: the reply leaves To approve at the click with "Sending",
  the next one opens, and a refusal puts it back with its words.

## Not now

- X Activity API: cents a month at our volume, but it needs credits. William's call; the tab
  watcher covers X meanwhile.
- YouTube WebSub and TikTok's webhooks: they push nothing anyone waits on.

## Decision log

- The webhook wakes the pass, it does not carry the comment: the pass's read is the one path that
  keeps a comment, so a lost, repeated or reordered webhook changes nothing.
- One `SocialPushed` per owner, not per platform: one pass serves a burst across platforms.
- Title counts, not the site's socket frames or badge selectors: every site keeps its title
  count current from its own channel, and one regex covers them all. Frames change shape without
  notice.
- An armed tab is its own page in the profile's browser, not the parked page, so another flow on
  the same profile can run meanwhile without losing it.
- Arms matched by path and target, not an id carried to the approve: the yes reaches autobrowse
  through four layers (InboxDesk, ReachDesk, Content, the channel). Threading an id through each
  buys nothing the path does not already say.
- Arming by running the channel over an arming client, not an `armReply` per channel: each
  channel already knows its write; a second copy per channel would drift.

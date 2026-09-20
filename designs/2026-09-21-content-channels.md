# Content channels: YouTube and LinkedIn, API first, browser for the gaps

Status: decided 2026-09-21 (William), not built. Where to attack is at the end.

## Decision

Organic content (LinkedIn posts, YouTube videos) is powered from this repo.
Each platform sits behind one port, `ContentChannel`. The adapter decides
per method whether the platform's API or an autobrowse flow does the work;
callers never know which. API wherever it exists; browser only where the
API refuses or is gated. This supersedes the 2026-09-17 content-core spec's
"no YouTube" and "nothing touches linkedin.com from code".

## The port

```ts
interface ContentChannel {
  readonly platform: "linkedin" | "youtube";
  publish(post: Post): Promise<Published>;          // irreversible: gated
  list(q: { limit?: number; before?: string }): Promise<PublishedRow[]>;
  metrics(id: string): Promise<Metrics>;            // views, reactions, comments
  comments(id: string, q?): Promise<CommentRow[]>;
  reply?(commentId: string, text: string): Promise<void>;
}
```

`Post` is text + optional media (image/video file or URL) + schedule. Rows
are rows (no bodies), every list pages, `before` is a cursor — same rules
as autobrowse's API. The port lives in `@wren/core`; adapters in
`@wren/channel-linkedin` (extending the inbox package) and a new
`@wren/channel-youtube`.

## API vs browser, per method

| platform | method | how | why |
|---|---|---|---|
| YouTube | publish (upload, title, description, tags, schedule, thumbnail) | Data API v3 `videos.insert`, `thumbnails.set` | full coverage; 1600 quota units per upload, 10k/day default |
| YouTube | list, metrics | Data API `videos.list`, Analytics API | covered |
| YouTube | comments, reply | Data API `commentThreads` | covered |
| YouTube | community posts, Studio-only settings | autobrowse (YouTube Studio) | no API |
| LinkedIn | publish text/image/video to a personal profile | Posts API with "Share on LinkedIn" (`w_member_social`, self-serve) | covered for the member's own posts |
| LinkedIn | list own posts, reactions/comments counts | Posts API + Social Actions (partner-gated for most reads) | browser when the app is not approved |
| LinkedIn | comments, replies, DMs, profile analytics | autobrowse | gated or no API |

Rule: an adapter method that uses the browser says so in its row
(`fetchedWith: "browser"`, already a column in `channel-linkedin`'s schema).

## autobrowse side

- Flows land in autobrowse as compiled workflows (`src/workflows/<site>-…`),
  recorded/explored once, proven, healed on drift. Sites: `linkedin`,
  `youtube` (Google login with the stored TOTP; the same `google` cred).
- Wren calls them through the Restate `browserService` by name (durable,
  already how domain provisioning's browser legs run). If wren needs more
  of autobrowse than "run this flow", the `Backend` port
  (`autobrowse/src/app/backend.ts`) gets an `httpBackend` adapter and wren
  depends on that interface, not on the worker.
- Publish steps are `irreversible`: the payment/irreversible gate holds them
  until answered, like buying a domain.

## Credentials (William)

- LinkedIn: `autobrowse creds paste linkedin` (email, password, authenticator
  key if on). Not stored today.
- LinkedIn developer app: Client ID/secret with "Share on LinkedIn" +
  "Sign In with LinkedIn using OpenID Connect". Creating the app needs a
  LinkedIn Page to attach it to.
- YouTube: a Google Cloud OAuth client (YouTube Data API v3 enabled) for
  the account that owns the channel. The consent screen is a one-time
  browser step the explore login can drive; the refresh token goes to the
  env store (`autobrowse env push`).

## Where to attack (ranked)

1. The port + fakes in `@wren/core`, with the paging/row rules tested.
2. YouTube adapter over the Data API (upload, list, metrics, comments).
3. LinkedIn publish over the Posts API; list/metrics via browser until the
   app is approved for reads.
4. autobrowse flows: `linkedin-post-metrics`, `linkedin-comments`,
   `youtube-community-post` — explore once each, prove, ship.
5. Scheduling: a Restate `ContentScheduler` (like `ComposeScheduler`)
   that publishes the approved queue on each platform's clock.

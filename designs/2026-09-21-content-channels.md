# Content channels: YouTube and LinkedIn, API first, browser for the gaps

Status: decided 2026-09-21 (William). Port + fake landed in `@wren/core/content`
(same day); adapters not built. Where to attack is at the end.

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

- autobrowse exposes each service under its official REST shape
  (`POST /api/sites/linkedin/rest/posts`, `GET /api/sites/youtube/youtube/v3/videos`).
  Each route goes API-first when a token is kept, browser otherwise; the
  caller sees `via: api|browser` per route. Setup steps
  (`developer-app`, `consent`, `oauth-client`) make the keys and tokens
  and keep them in autobrowse's env store. Spec:
  `autobrowse/designs/2026-09-21-site-apis.md`.
- Wren reaches it as the Restate service `sites` on the same Restate
  (`restateSites(ctx)` in `@wren/core/content/restate`, like the `browser`
  service domain provisioning uses): no port on the box, calls queue while
  it is down. With `WREN_AUTOBROWSE_INSTANCE_ID` set, the first `sites`
  call of an invocation is preceded by one journaled `wake autobrowse`
  step (`ec2Wake`: start the instance if stopped, tag
  `autobrowse:started-by=wren`); Restate holds the call until the worker
  is back on the tunnel (~1–2 min). The box stops itself after
  `IDLE_STOP_MINUTES` of nothing (autobrowse side), so a Content call costs
  minutes of box time, not a day. The Lambda role gets
  `ec2:StartInstances`/`CreateTags` on that one instance
  (`autobrowse_instance_id` tfvar). `autobrowseSites({url, token})` is the HTTP `SiteClient` for
  a laptop against a local autobrowse. Either is a `SiteClient` (`call`,
  `via`); the
  adapters (`linkedinContent` in `@wren/channel-linkedin`, `youtubeContent`
  in `@wren/channel-youtube`) speak the real API shapes through it, so
  they do not know whether a call ran over HTTP or a browser. Every row
  carries `fetchedWith` from autobrowse's `via`.
- The worker mounts them as the Restate `Content` service
  (`@wren/core/content/restate`): `publish/list/metrics/comments/reply`,
  keyed by platform; channels are built per invocation from its context so
  every site call is a journaled `sites` call (a write runs once on the
  worker: no duplicate posts). On when `WREN_CONTENT_CHANNELS=linkedin,youtube`.
- Publish steps are `irreversible` on the autobrowse side: the gate holds
  browser-leg posts until answered, like buying a domain.

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

1. ✅ The port + fake in `@wren/core/content` (`ContentChannel`, `pageOf`, `fakeContentChannel`).
2. ✅ YouTube adapter over the Data API (upload, list, metrics, comments) via autobrowse's site API.
3. ✅ LinkedIn adapter over the Posts/Social Actions API shapes via autobrowse; reads
   run over the browser leg until the app is approved.
4. ✅ `Content` Restate service in the worker (2026-09-20).
5. autobrowse: record the setup workflows and the gated LinkedIn reads
   (`linkedin-list-posts`, `-post-stats`, `-post-comments`, `youtube-community-post`)
   — explore once each, prove, ship. Needs William's creds (NEEDS-WILLIAM.md).
6. ✅ Reachability: through Restate (`sites` service). ✅ Wake (2026-09-20):
   `ec2Wake` before the first `sites` call; idle-stop on the autobrowse
   side. Both terraforms applied 2026-09-20; `IDLE_STOP_MINUTES=30` in the
   autobrowse env store.
7. Scheduling: a Restate `ContentScheduler` (like `ComposeScheduler`)
   that publishes the approved queue on each platform's clock. Next, with
   the composer: notes/ideas → one draft per platform → review →
   scheduled publish (`designs/2026-09-22-content-loop.md`).
9. ✅ Four more platforms (2026-09-22): `Platform` is now linkedin |
   youtube | x | instagram | facebook | tiktok. `@wren/channel-x`
   (autobrowse `x` site: media upload then `/2/tweets`, own posts,
   `public_metrics`, replies by search when the tier allows),
   `@wren/channel-meta` (`instagramContent` + `facebookContent` over the
   `meta` site: the Page from `/me/accounts` once, its Instagram account,
   Reel container → publish, Page feed/photos/videos, insights) and
   `@wren/channel-tiktok` (Content Posting API, `PULL_FROM_URL`). Graph
   and TikTok only take URLs, so a local file goes through a `MediaHost`
   first: `s3MediaHost` in the worker (`WREN_MEDIA_BUCKET`, presigned GET
   for a day). `WREN_META_PAGE_ID` picks the Page; the first otherwise.
   `WREN_CONTENT_CHANNELS` takes the new names. A YouTube short lands on
   Instagram, TikTok and X by publishing the same file to each channel;
   the composer (next) writes the caption per platform.
8. ✅ One verb (2026-09-21): `autobrowseDo({url, token})` / `restateDo(ctx,
   wake)` in `@wren/core/content` call autobrowse's `do`: a goal in
   ("upload this to youtube" + `{file}`), what ran out. autobrowse routes it
   to a site route, a compiled workflow or a flow; with nothing ready its
   agent explores once and the result is compiled under the missing leg's
   name, so the second ask is deterministic. New code that needs a chore
   done calls `do` first and drops to `sites.call` only when it needs the
   official shape.

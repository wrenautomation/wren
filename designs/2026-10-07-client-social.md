# Client social (2026-10-07)

GoHighLevel's Social Planner, our way. A client connects its own social accounts on Account → Social: Facebook Page, Instagram business, LinkedIn, YouTube channel, X, TikTok, Google Business Profile. Wren then plans and posts for it, reads its comments and DMs into its Inbox, and replies from there. Every send waits on the client's sends flag and its To approve.

## Answer first

- One OAuth sign-in per account, on Wren's own app for each platform. Wren never asks for a password.
- Refresh tokens and Page tokens go to the key store (`designs/2026-10-07-key-store.md`), sealed under the client. Access tokens stay in memory for their life. None of them is printed or journaled.
- A connected account plugs into the paths Wren already runs for itself: the planner, the publisher, SocialWatch and ContentMetrics. They use the same channel adapters, now over a direct API client that runs on the client's token.
- Comments land in the client's Inbox the way Wren's do. DMs (Facebook, Instagram, X) arrive through a new reader into the client's own `reach_contacts` and `reach_messages`.
- A reply from the client's Inbox goes out on the client's own account. It goes through the Inbox reply gate (Ask to send, approver) and writes a touch.
- Four states per platform: Not connected, Waiting on review, Connected, Broken.
- Today only X and a LinkedIn profile work for any client. Meta, YouTube and TikTok work for clients Wren adds as testers. Business Profile waits on Google's access grant.

## Status

| Platform | Status | Works today | Waits on |
|---|---|---|---|
| X | Buildable now | Post, reply, read mentions, DMs | X's pay-per-use credits on Wren's account (William funds) |
| LinkedIn profile | Buildable now | Post as the person | Nothing. Comment reads need a closed scope |
| LinkedIn company page | Built on fakes, needs app review | Nothing until the app passes; then post, read and answer comments as the page | Community Management API, separate app (William applies, free) |
| Facebook Page | Needs app review | Testers only: post, comments, DMs | Meta App Review and Business Verification (William applies, free) |
| Instagram business | Needs app review | Testers only: post, comments, DMs | The same Meta review |
| YouTube | Needs app review | Test users only: private uploads, comments | Google OAuth verification and the YouTube API audit (William applies, free) |
| TikTok | Needs app review | Sandbox users only: private posts | TikTok app review and the Direct Post audit (William applies, free) |
| Business Profile | Built on fakes, needs access | Nothing until access; then local posts, reviews in, review answers | Google's Business Profile API access form (William applies, free) |

None of the reviews cost money. X is the only platform that bills per call.

## Per platform

Every redirect URI is `<portal origin>/oauth/social/<platform>`. Each app needs it added once.

### Facebook Page

- API: Graph API v23.0, Facebook Login for Business.
- Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `pages_messaging`, `business_management`.
- Review: each scope needs Advanced Access through App Review (a screencast per scope), plus Business Verification. Free. William applies.
- Today: the app is in development mode. Only people with a role on the app can grant scopes. Wren's team adds the client's admin as a tester. The admin accepts the invite on developers.facebook.com, then connects.
- Tokens: the short user token becomes a long-lived user token, which yields the Page token. A Page token from a long-lived user token has no expiry. Wren stores the Page token only. It breaks when the person changes their password, loses Page admin, or removes the app.
- DMs: `/{page}/conversations?platform=messenger` and `/{conversation}/messages`. A send is `POST /{page}/messages` with `messaging_type: RESPONSE`. It only works within 24 hours of their last message.
- Self-serve: press Connect, sign in, pick the Page.
- Done for you: Wren's team adds the admin as a tester. Before review, that's the only route.

### Instagram business

- API: Instagram API with Facebook Login, through the Page the account is linked to.
- Scopes: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, plus the Page scopes above.
- Review: the same Meta review and verification.
- Today: testers only, as with the Page.
- Publishing: a container from a public URL, then `media_publish`. Comments come from `/{media}/comments` and replies go to `/{comment}/replies`. DMs come from `/{page}/conversations?platform=instagram` and have the same 24-hour window.
- Self-serve: switch the account to Business or Creator, link it to the Page, then Connect. One sign-in connects the Page and its Instagram.

### LinkedIn

- Profile: the app has "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Scopes `openid profile email w_member_social`. Self-serve, no review. Posts go to `/rest/posts` as the person. Reading comments needs `r_member_social`, which LinkedIn closed, so comments come in only through autobrowse logins.
- Tokens: 60 days, with no refresh token for these products. The check says Broken at expiry and warns 7 days ahead. The client reconnects every 60 days.
- Company page: needs the Community Management API (`w_organization_social`, `r_organization_social`, `rw_organization_admin`). It must be the only product on its app, so it's a second app: verify the business, then the Development tier, then Standard tier review with a screencast. Free. William applies. It comes with 1-year refresh tokens.
- Company page, built: its own platform `linkedin_page` on the app `linkedin_pages`. Landing reads the first page the member admins (`organizationAcls`), then its name, and keeps its URN in `extra.orgUrn`. It posts on the `linkedin` channel as the page, ahead of a connected profile. Comments are read by URN, the page's own answers are kept as ours, and an answer to a comment names its post and parent. Followers come from `networkSizes`. Connect stays off until `linkedin_page` is in `WREN_SOCIAL_LIVE`.
- A connected profile or page has no browser reads: no notifications, no audience page, no analytics page.
- DMs: LinkedIn has no messaging API for pages or members. DMs stay on autobrowse logins.

### YouTube

- API: YouTube Data API v3 with Google OAuth and offline access.
- Scopes: `youtube.upload`, `youtube.force-ssl` (comments and replies), `youtube.readonly`.
- Review: OAuth consent screen verification for sensitive scopes. It needs a privacy policy, a demo video and a verified domain. Free. Also the YouTube API compliance audit, which lifts the private-only lock on uploads and raises quota. Free.
- Today: the project is in Testing mode. Up to 100 test users. Refresh tokens expire after 7 days in Testing, so the check shows Broken weekly. Uploads stay private until the audit passes.
- DMs: none.
- Self-serve: Connect, sign in with the Google account that owns the channel, allow upload and manage.

### X

- API: v2, OAuth 2.0 authorization code with PKCE.
- Scopes: `tweet.read tweet.write users.read offline.access dm.read dm.write media.write`.
- Review: none. The app is on pay-per-use, so every call bills Wren's credits. Each client's calls go through its vendor gate, so the meter shows them per client.
- Tokens: the access token lasts 2 hours. The refresh token rotates on every use, and the key store keeps the newest under the same ref.
- DMs: read from `/2/dm_events`, send with `POST /2/dm_conversations/with/{participant}/messages`.
- Media: images in one upload. Videos on the chunked upload (`/2/media/upload/initialize`, `/{id}/append` per 4 MB, `/{id}/finalize`, then `STATUS` until processed, 5 minutes at most).
- Self-serve: Connect and authorize.

### TikTok

- API: Login Kit v2 and the Content Posting API (Direct Post from a URL), plus the Display API for the video list.
- Scopes: `user.info.basic`, `user.info.stats` (followers per day), `video.publish`, `video.upload`, `video.list`. A token from before `user.info.stats` answers followers with 403 (needs scope); its posting still works.
- Review: app review for production, with a demo video per scope. Direct Post also needs its own audit, and until it passes every post is `SELF_ONLY`. Free. William applies.
- Today: sandbox. Only target users added to the sandbox can connect. Posts stay private.
- Tokens: the access token lasts 24 hours and the refresh token 365 days.
- Comments and DMs: TikTok has no public API for either.

### Google Business Profile

- API: Business Profile APIs, scope `business.manage`. Local posts go to `accounts/{a}/locations/{l}/localPosts`. Reviews and replies come from the v4 reviews endpoints.
- Review: the Business Profile API access form. A project starts at 0 requests a minute until Google approves it. Free. William applies.
- Today: nothing works, so Connect is off and the page says Waiting on review.
- DMs: Google shut Business Messages down in July 2024. There are no DMs.
- Built here: `google_business` is a content platform, so posts go through the planner, To approve and the scheduler. Landing keeps the first location as `accounts/{a}/locations/{l}`. A post is a STANDARD local post with an optional button and photo. Reviews come in as comments on the location (`ContentChannel.reviews`), with stars in the text, and an answer goes to the review's `reply`. Google gives no numbers per post, so insights say so.
- A Business Profile autobrowse login stays for review asks. It never posts.

## Wren's apps

App ids and secrets live in the key store under the client `wren`:

| Names | App |
|---|---|
| `SOCIAL_META_CLIENT_ID`, `SOCIAL_META_CLIENT_SECRET` | Meta app (Facebook Page, Instagram) |
| `SOCIAL_LINKEDIN_CLIENT_ID`, `SOCIAL_LINKEDIN_CLIENT_SECRET` | LinkedIn app |
| `SOCIAL_LINKEDIN_PAGES_CLIENT_ID`, `SOCIAL_LINKEDIN_PAGES_CLIENT_SECRET` | LinkedIn company page app (Community Management API) |
| `SOCIAL_GOOGLE_CLIENT_ID`, `SOCIAL_GOOGLE_CLIENT_SECRET` | Google OAuth client (YouTube, Business Profile) |
| `SOCIAL_X_CLIENT_ID`, `SOCIAL_X_CLIENT_SECRET` | X app |
| `SOCIAL_TIKTOK_CLIENT_ID`, `SOCIAL_TIKTOK_CLIENT_SECRET` | TikTok app |

A missing app makes its platforms show "Needs setup: Wren's <name> app" with Connect off. `WREN_SOCIAL_LIVE` lists the platforms whose review has passed (`facebook,instagram`). A platform missing from the list shows Waiting on review until it connects. Testers can still connect.

## Where tokens live

- `social_grants` (main): one sign-in in flight. It holds the random `state`, the PKCE verifier, the client, the platform and who asked. It lasts 30 minutes and works once.
- `social_connections` (main): one connected account. It holds the client, platform, the account's id, name and handle, scopes, state (`connected` or `broken`), why, `token_ref` (`ks_…`), when the token expires, when it was checked, and who connected it. Each has a `client_accounts` row on site `social` (ref `<platform>:<account id>`), so the setup system rechecks it.
- The key store holds the secret as JSON under `SOCIAL_<PLATFORM>_<16 hex of the account id>`: `{refresh}` for X, TikTok and Google, `{access, expiresAt}` for LinkedIn, `{page}` for Meta.
- The callback carries the code through Restate's journal. It's single use and lives for minutes, as mail access accepted. The exchange runs inside one `ctx.run` that returns only the page's sentence. The refresh token goes from there straight into the key store.
- Calls on a client token run inside `journaledSites`, one `ctx.run` per call, and journal only the platform's answer. The token is read and refreshed inside the step. 401, 403 or `invalid_grant` marks the connection Broken with a reason.

## How Wren's paths take a client account

- `clientContent` (`packages/content/src/clients.ts`) adds each connected account to `logins` as `social:<connection id>` and widens `platforms`. The planner, publisher, SocialWatch and ContentMetrics all read it, so each one takes a client account without any other change.
- The worker's `contentClientsFor` builds each platform's existing adapter (`linkedinContent`, `facebookContent`, `instagramContent`, `youtubeContent`, `xContent`, `tiktokContent`) over `socialSites`, the direct API client. That runs inside `journaledSites` and the client's vendor meter. Meta gets the connected Page's id.
- `socialSites` speaks each platform's official API. GETs go as a query, writes as JSON, with LinkedIn's version headers. The Meta Page lookup (`/me/accounts`) is answered from the connection. YouTube and X uploads take a hosted URL; an X video goes up in chunks.
- `Content`'s own wall (`sendsOn(client, "content.posting")`) still stops every post and comment reply from a client whose posting is off.

## Inbox

- Comments: SocialWatch reads a client's comments into its `comments` table and its Inbox. A connected account is read whether or not Wren runs that channel itself (`WREN_CONTENT_CHANNELS` names only autobrowse channels). Post comments are read only where the account can: Facebook, Instagram, YouTube, X and a company page. A LinkedIn profile and TikTok can't.
- Reviews: SocialWatch reads a connected Business Profile's reviews each pass, kept as comments on the location.
- Who answers: a LinkedIn comment answers through a connected company page; a review through the Business Profile.
- DMs: `SocialInbox.read` runs on SocialWatch's client pass. It reads Facebook, Instagram and X conversations into the client's `reach_contacts` (platforms widened to `facebook`, `instagram` and `x`) and `reach_messages` (in). Each new message writes a touch.
- Reply: InboxDesk's client channels stop refusing. A comment goes through `Content.reply` with the client and is marked answered in the client's database, which writes the touch. A DM goes through `SocialInbox.send` on the client's account. That checks `sendsOn(client, "reach.outreach")` again, writes the message out and the touch, and refuses outside a 24-hour window on Meta.
- The reply gate is unchanged: sends off, or a member without approve, means Ask to send, and the reply waits in To approve.

## States

| State | When |
|---|---|
| Not connected | No connection, and the platform is live or works today |
| Waiting on review | No connection, the platform's review isn't done, and it isn't in `WREN_SOCIAL_LIVE`. Connect stays on for testers, except Business Profile |
| Connected | Its last check refreshed or read |
| Broken | Revoked, expired, or refused with 401 or 403. Connect again fixes it |

`setup.social` runs on each connection's account. Its one step, `social.token`, runs hourly: a refresh, or a who-am-I read where nothing refreshes. A failure there is Broken. SetupWatch starts it again once it's lost.

## Built here (on fakes)

- Design, schema and migration: `social_grants`, `social_connections`, `reach_contacts` platforms.
- OAuth per platform with injected fetch: connect URL, exchange, refresh, identity.
- `socialAccess`: view, connect, land, check, disconnect, token, broke.
- `socialSites`, the direct API client per platform.
- `setup.social` and its `social.token` check.
- `clientContent` and the worker's `contentClientsFor` taking connected accounts, not gated by `WREN_CONTENT_CHANNELS`. `Content` is bound even when Wren runs no channel.
- LinkedIn company pages: platform, app, landing, adapter (`organization`), comment reads and answers.
- Business Profile: `businessProfileContent` (posts, reviews, review answers), its `socialSites` route (its own location only), SocialWatch's review read, Inbox routes.
- Comment reads: Instagram asks for the author's name; Facebook keeps parents and the Page's own answers.
- `SocialInbox` (read, send) and InboxDesk's client DM and comment senders.
- `SocialAccess` portal service, `SocialCallback`, `/oauth/social/<platform>` on the portal Worker, the Account → Social page.

Not built: Meta's HUMAN_AGENT tag past 24 hours, picking one of several company pages or locations (the first is taken), Business Profile per-location numbers (Performance API), event and offer posts.

## What William does

1. Put each app's id and secret into the key store: `wren keys put --client wren SOCIAL_X_CLIENT_ID`, and so on.
2. Add `<portal origin>/oauth/social/<platform>` to each app's redirect URIs.
3. Apply for the reviews: Meta App Review and Business Verification, Google OAuth verification and the YouTube audit, TikTok review and the Direct Post audit, LinkedIn Community Management, the Business Profile access form.
4. Fund X credits.
5. As each review passes, add the platform to `WREN_SOCIAL_LIVE`.

## Decision log

- 2026-10-07: one connection per account, on Wren's apps. A client never makes its own developer app, as on GoHighLevel.
- 2026-10-07: a Meta connection stores the Page token, not the user token. It has no expiry and can't reach the person's other Pages.
- 2026-10-07: DMs go into the existing `reach_contacts` and `reach_messages`, so the Inbox, touches and the reply gate need no new thread type.
- 2026-10-07: review state comes from config (`WREN_SOCIAL_LIVE`). No platform tells an app its review state.
- 2026-10-09: a company page is its own platform (`linkedin_page`) on its own app, posting on the `linkedin` channel. When a client has both, the page wins over the profile.
- 2026-10-09: Business Profile is a full content platform (`google_business`). Its reviews are comments on the location, read through a new optional `ContentChannel.reviews`.
- 2026-10-09: connected accounts don't wait on `WREN_CONTENT_CHANNELS`. That list gates Wren's autobrowse channels only.
- 2026-10-09: X video upload on the chunked v2 endpoints, so a client's X can post video. TikTok's missing-scope 401 (`scope_not_authorized`) is a 403 and leaves the connection connected; any other 401 still breaks it.

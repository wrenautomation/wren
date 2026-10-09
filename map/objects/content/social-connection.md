---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-09 @ 1727a859
entity: packages/content/src/connect/schema.ts:68
---

# social connection (a client's own social account)

A client's Facebook Page, Instagram business, LinkedIn profile or company page, YouTube channel, X, TikTok or Google Business Profile, connected by one sign-in on Wren's app for that platform, so Wren posts, reads comments and DMs, and replies as the client (designs/2026-10-07-client-social.md). Rows: `social_connections`, `social_grants`.

## Why this shape

GHL's Social Planner, on official APIs only. One app per platform, one sign-in per account; tokens in the key store under the client, never in Postgres. The connection is a `client_accounts` row of site `social`, so the setup engine checks it hourly and alerts like any other. Its login in `clientContent` is `social:<id>`, so the planner, scheduler, metrics and social reads use the same content adapters as Wren's own channels, over `socialSites` in place of autobrowse.

## Shape

- `social_grants` (`schema.ts:30`): one-time OAuth `state` + PKCE verifier, 30 min, spent by `SocialCallback/land`
- `social_connections` (`schema.ts:68`): client, platform, external id, name, handle, scopes, `token_ref`, `expires_at` (LinkedIn's 60 days), `extra` (Page id, IG user id, company page URN, Business Profile location), state connected/broken with `why`
- Platforms (`platforms.ts`): `SOCIAL` spec per platform (app, scopes, PKCE, dms, comments, what review gates, what works before it, self-serve and done-for-you copy); `liveFrom(WREN_SOCIAL_LIVE)`, X and LinkedIn profile always live. A company page (`linkedin_page`) is its own app, `linkedin_pages`, on the `linkedin` channel. Import-free: the portal Worker reads it
- OAuth (`oauth.ts`): `connectUrl`, `landCode` (Meta: code, long-lived user token, Page token kept), `refreshToken` (X and TikTok rotate), `whoAmI`. Errors carry the platform's code and first line, never a body
- Access (`access.ts`): `socialAccess` (`:178`) connect, land, check, disconnect, `tokenOf` (memory cache, key store rotate), `broke`; `platformStates` (`:123`): not_connected, waiting_review, connected, broken; `liveConnections` (`:477`)
- Calls (`sites.ts`): `socialSites` is a `SiteClient` per platform on the client's token; 401 or Meta code 190 marks it broken. An X video uploads in 4 MB chunks (initialize, append, finalize, STATUS until processed); TikTok's `scope_not_authorized` is a 403 that leaves the connection up; a client's TikTok asks `user.info.stats` for followers; a Business Profile reaches only its own location's `/v4` paths
- Business Profile (`business.ts`): `businessProfileContent` posts local posts, reads reviews as comments on the location (`ContentChannel.reviews`), answers a review
- `clientContent` gives each channel's `connected` account (a company page ahead of a profile), and which channels read `comments` and `reviews`; SocialWatch reads only those, and connected accounts don't wait on `WREN_CONTENT_CHANNELS`
- DMs (`dms.ts`): Facebook, Instagram, X. `readDms` + `keepDms` into the client's `reach_contacts`/`reach_messages` (a `theirs` touch each); `planDm` (Meta's 24 h window, opt-outs), `sendDm`, `sentDm` (an `ours` touch, draft log)
- Services: `SocialAccess` (`console.ts:125`, routes `console-routes.ts`), `SocialCallback/land` (`console.ts:192`, private; portal Worker `/oauth/social/<platform>`, `apps/portal/src/social-oauth.ts`), `SocialInbox` read/send/answer (`packages/content/src/restate/social-inbox.ts:71`)
- Setup: `setup.social`, check `social.token` hourly (`setups.ts`)
- App reviews (`app-reviews.ts`, designs/2026-10-09-app-reviews.md): `REVIEWS` (each platform review: fields, permission text from `SOCIAL`'s scopes, screencast, open items, what it unlocks), `checkReview` (public pages for their words, callbacks served, prod keys, the 1024 icon at `deploy/reviews/`), `packetOf`. The mail apps' Google verification and Microsoft publisher verification sit in the same table. Filing is a person's act; a pass goes into `WREN_SOCIAL_LIVE`

Citations: `packages/content/src/connect/schema.ts:30`, `:68`; `packages/content/src/connect/access.ts:123`, `:178`; `apps/worker/src/services.ts:433`

## Connected to

- **owned-by:** [[platform/account-setup]] (`client_accounts` rows of site `social`)
- **joins:** [[content/inbox-thread]] (a client's DM or comment reply goes InboxDesk → `SocialInbox.send`/`answer`, after Ask to send and its approver); [[content/platform]] (`clientContent` logins)
- **looks-like-but-is-not:** Wren's own channels (autobrowse `sites`, `WREN_CONTENT_CHANNELS`); reach's Reddit and LinkedIn DMs

## If you change this

- **Hits:** `REVIEWS` (a new scope needs its reason there, or the test fails), Account → Social (`apps/portal/web/src/modules/account/Social.tsx`), `clientContent`, SocialWatch's client pass, InboxDesk's client DM and comment paths (`inbox/routes.ts`), migrations 0190 and 0197
- **Does not hit:** Wren's own posting, reach

## Surfaces

| Surface | Role |
|---|---|
| Account → Social (client owners and admins; Wren's team for any client) | reads, writes (connect, check, turn off) |
| `/oauth/social/<platform>` (portal Worker) | writes (lands a grant) |
| SetupWatch, `social.token` hourly | checks, marks broken |
| SocialWatch client pass | reads comments, Business Profile reviews, and DMs through `SocialInbox.read` |
| Inbox reply on a client's DM or comment | sends, behind `reach.outreach` sends and To approve |
| `wren app-reviews` (list, packet, check) | reads `REVIEWS`, checks the live pages, callbacks and prod key names |

## See

- Source: `packages/content/src/connect/`
- Design: `designs/2026-10-07-client-social.md`

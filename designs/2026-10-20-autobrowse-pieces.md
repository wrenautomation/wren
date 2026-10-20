# wren takes vendor pieces from autobrowse, not its own copies

2026-10-20. William: "make sure wren is fully using autobrowse properly, and autobrowse also
supports things like email checking, sms verification connection. i think those might have
been placed in wren, when they should have been in autobrowse."

## Rule

A vendor API lives in autobrowse when it needs any of: keys or tokens made in a browser, a
login or OAuth consent, a browser fallback, caps or key rotation, or reading mail or SMS. A
plain key plus the vendor's official SDK stays where it is used.

autobrowse ships it two ways:
- **Piece** (library, `@wrenautomation/autobrowse/<sub>`): pure functions that take `http`,
  creds and tokens as arguments. wren imports these and runs them in its own Lambda.
- **Service** (desk `desk/call`): only work that needs the Mac's browser or profiles.

wren uses a piece when no browser is needed. The Mac stays out of the path for reply
reading and client tokens: it sleeps, and a client's token must not reach William's desk.

## Today

wren has no dependency on the autobrowse package. It reaches autobrowse only over the
service (`autobrowseSites`, `TokenRenewal/box`). Everything else is wren's own copy.
SMS and email code reading already live only in autobrowse (`auth/codes.ts`,
`clients/twilio.ts`, `clients/linq.ts`). Nothing to move there.

## Moves (from the 10-20 audit)

| # | wren today | autobrowse piece | wren keeps |
|---|---|---|---|
| 1 | `channel-email/src/inbox/imap.ts`, `inbox/instantly.ts` | `./mail`: `imapReader`, `instantlyReader` in the `InboxReader` shape | `inbound.ts`, `sync.ts`, `thread_events` writes |
| 2 | `channel-email/src/send/google-auth.ts`, `core/src/mailbox.ts` delegated path | `./google`: delegation token mint + Gmail read/send wire (`google-auth.ts`, `clients/gmail.ts`) | the send tick |
| 3 | `channel-email/src/access/oauth.ts`, `access/mailbox.ts`; `content/src/connect/oauth.ts`, `platforms.ts`; `core/src/oauth.ts`; `connectors/src/oauth.ts` | `./oauth`: one `OAuthSpec` per provider + `authorizeUrl`, `exchange`, `refresh`, `whoami` (from `sites/oauth.ts`, `sites/renew.ts`, `auth/*`) | the portal pages, the stored-token rows, the redirect handler |
| 4 | `channel-reddit/src/api.ts`, `direct` mode in `channel-linkedin`/`channel-tiktok` content | the site's route `api` functions from `./sites` | the channel adapters |

Kept in wren (plain key or wren-only): SMTP send, Postmaster, Telnyx/Linq business SMS and
voice, Calendar, Cloudflare domains, HubSpot/Jobber/Wise/Stripe/GitHub, the Browserbase
render tier, `vendor-direct*` (a client's own key must not be journaled into autobrowse),
YouTube Data API reads (plain key; revisit if quota bites).

## Order

1. autobrowse: add `./mail`, `./google`, `./oauth` exports. Pieces import no Playwright
   (a test fails if one does). Publish a new version.
2. wren: add the package (exact version), switch move 1 to 4 one at a time, delete the
   copies. Each move keeps its tests green against synthetic data.
3. Maps on both sides: `site-api`/`token` cards in autobrowse, `content/platform` and the
   email cards in wren. Root CLAUDE.md seam table gets a "vendor pieces" row.

## Decision log

- Library over service for non-browser work: no new hop, no Mac uptime dependency, client
  tokens stay in wren's account. The service stays for browser and profile work.
- npm version, not a workspace link: the repos are separate and CI builds wren alone.
- Moves 3 and 4 touch live client connections. Each switch is a refactor behind the same
  token rows; no client reconnects. If a provider's refresh shape differs, wren's wins.
- 10-20 build: pieces take `fetch`, not autobrowse's `HttpClient`. Each caller keeps its own
  time limit and retry policy; a piece adds none. wren wraps Gmail with `timedFetch` (2 min) in a
  thin `GmailClient` subclass; autobrowse wraps its `HttpClient` with `fetchOf`.
- Google auth: wren's copy won (clearer key errors, signing error wrapped, `postmasterToken`).
  The unified `./google` adds autobrowse's `SCOPES`, `delegatedScopes`, `authedJson`. The Gmail
  wire is wren's `GmailClient` plus `searchAll`, `getMessage`, `sendAs`, `patchSendAs`;
  autobrowse's per-user `gmailClient` now sits on it. `GmailTransport`, `plainMailer` and
  `neverLeft` stay in wren: they decide what a send failure means.
- `./mail`: `ImapReader` takes the IMAP login, not wren's roster row. The roster and
  `InstantlyTransport` stay in wren.
- `./oauth`: two error parsers stay two. Mail and connectors keep `tokenPost`/`oauthErrorOf`;
  social connect keeps `platformJson`/`platformErrorOf` (Meta 190, HTTP 401, TikTok `ok`).
  Merging them would change which errors read as revoked. Endpoints live once in
  `OAUTH_PROVIDERS`; scopes, labels and UI copy stay in wren (`platforms.ts` and connectors
  `apps.ts` stay import-free for the portal Worker). autobrowse's consent driver, mint cache
  and `renew.ts` stay in `sites/`: they need env, files or the browser.
- Move 4 skipped. autobrowse route modules are not browser-free (linkedin, tiktok and youtube
  routes import browser flows or Playwright), and `./sites` exports the facade and Restate
  service. Their `api` legs also differ from wren's direct mode (Meta `/me/accounts` page
  tokens, URL media uploads, TikTok ranged upload and status polls, dead token to broke).
  Matching them would change live client posting. Reddit stays parked. Revisit when route
  `api` legs move into a pure module.

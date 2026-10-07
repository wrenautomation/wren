# Client mail access (2026-10-07)

William: "reading client mail has gates. Gmail: restricted scopes need a yearly CASA review (from $675, about 6 weeks) unless the client's Workspace admin trusts our app. Send-only (gmail.send) needs no CASA. Microsoft: since late 2025 each client's admin must consent to Mail.Read." And: "if this is something we can automate, and / or easily setup with our clients after getting them signed up thats completely fine."

## Answer first

- Mail access is a set of setup workflows a client runs after signup, on Account → Mail.
- Google Workspace: the admin marks Wren's app Trusted once per domain. Then each person signs in once as their mailbox. We don't use domain-wide delegation (see the next section for why).
- Personal Gmail, or a domain whose admin won't trust the app: the mailbox can send. Reading shows "Needs Workspace trust" with the reason. Sending needs no CASA review.
- Microsoft 365: the admin opens one consent link for the organization, then each person signs in once as their mailbox. Personal Outlook isn't supported.
- Reading: a 15-minute poll per client puts new mail in that client's Marketing → Inbox, sorted by the Monitor's rules and model. Polling costs $0 and needs no Pub/Sub or Graph subscriptions.
- Refresh tokens go to the key store (`designs/2026-10-07-key-store.md`), sealed in Postgres. They are never printed or journaled.
- Done for you is marked "In development": there's no admin console to build and test against, and William's own Google is off limits.
- Waiting on William: two app registrations (Google and Microsoft) and the key store's infra steps. Until then the page says "Needs setup: Wren's Google app" (or Microsoft). Everything else is built and tested on fakes.

## Trusted app, not domain-wide delegation

Domain-wide delegation lets a service account act as any user in the domain, on every scope the admin lists. One leaked key reads every mailbox in the company. The admin has to paste scope URLs by hand, and the grant can't be limited to a team.

A trusted app gets no more than each person grants when they sign in, and only for that person's mailbox. The admin can trust it for one team, not the whole company. Revoking one person cuts off one mailbox. Trust only lifts Google's restricted-scope block, so Wren never holds more than someone signed in for. That is the least scope that works. The cost is one sign-in per mailbox.

## Client steps

### Google Workspace (once per domain, by a super admin)

1. Sign in to the Google Admin console as a super admin.
2. Go to Security → Access and data control → API controls → App access control. The page links straight there.
3. Choose Manage third-party app access → Add app → OAuth app name or client ID, and paste Wren's client ID (the page has a Copy button).
4. Pick Wren, choose who it covers (everyone, or the team whose mail Wren reads), and set it to Trusted.
5. Connect one mailbox on that domain to read, then press Check.

Then each person presses Connect to read and send next to their mailbox and signs in. Google can take a few minutes to apply trust to every mailbox.

### Microsoft 365 (once per organization, by an admin)

1. Press Get consent link. Send it to the admin, or open it if you're the admin.
2. The admin signs in and accepts: read mail, send mail, stay signed in. The consent covers the whole organization, and the link returns them to the page.
3. Press Check. Then each person connects their own mailbox.

### Any mailbox

Add the address, pick Google or Microsoft 365, and pick "Read and send" or "Send only". Press Connect and sign in as that mailbox. Signing in as a different address is refused.

## Mailbox states

| State | Means | Next |
|---|---|---|
| Not set up | no sign-in yet, or Wren's app is missing | Connect it, or wait on Wren's team |
| Waiting on admin | wants to read; trust or consent isn't done | the admin's steps above the list |
| Connected (send only) | can send; reading is blocked or not wanted | trust, then Connect to read, if reading is wanted |
| Connected (read and send) | done | none |
| Broken | the grant was revoked, or the API returned 401/403 | Connect it again |

A client sees only its own mailboxes. Wren's team can open any client. In team view on Wren itself, the page says Wren's mail belongs to the Monitor.

## How it's built

- Accounts (`packages/core/src/setup.ts` sites): `google_workspace` and `microsoft_365`, one per domain; `mailbox`, one per address, with role `send` or `read`. Adding a mailbox adds its domain's account when needed. Personal Gmail gets none.
- Setups (`packages/channel-email/src/access/setups.ts`): `setup.google_mail` (app, then trust), `setup.microsoft_mail` (app, then consent) and `setup.mailbox` (connected). Each step has a check every hour or day. SetupWatch rechecks, and a lost fact restarts the setup.
- Checks (`mailChecks`):
  - `mail.google_app` and `mail.microsoft_app`: is Wren's app configured?
  - `google.mail_trust`: a real Gmail read on a connected read mailbox in the domain. Google exposes no trust status, so a working read is the proof.
  - `microsoft.admin_consent`: a consent row for the tenant, plus a client-credentials token. AADSTS700016 means the admin hasn't consented.
  - `mailbox.token`: a token refresh that still returns the scopes the mailbox needs.
- OAuth (`access/oauth.ts`): authorization code with PKCE and a one-time `state` (a `mail_grants` row that expires in 30 minutes; 7 days for consent links). Google asks for `access_type=offline`, `prompt=consent` and `hd` for Workspace. Microsoft uses the tenant in the path and the v2 `adminconsent` endpoint with explicit scopes.
- Scopes: send asks `gmail.send` or `Mail.Send`. Read adds `gmail.readonly` or `Mail.Read`. All requests include `openid email`; Microsoft also gets `offline_access`. Wren skips `gmail.modify` because Done is kept in Wren, not as a Gmail label.
- Callback: `/oauth/mail/google` and `/oauth/mail/microsoft` on the portal Worker (`apps/portal/src/mail-oauth.ts`). It forwards the known query names to `MailCallback/land` and shows a plain Connected or Not connected page. It sends no-store, no-referrer and a strict CSP.
- Tokens:
  - `{refresh, address}` JSON in the key store (`designs/2026-10-07-key-store.md`), under the mailbox's client as `MAIL_<PROVIDER>_<16 hex of sha256(address)>`. `mail_connections.token_name` holds its ref. Every read is an event with who and why.
  - Access tokens live only in memory. Microsoft's rotated refresh token is written back.
  - A revoked grant (`invalid_grant`) or a 401/403 marks the connection Broken with a reason.
- Reader (`packages/watch/src/clients.ts`): `MailReader/all`, every 15 minutes. For each client with the `mail.triage` part, it reads each connected read mailbox through the Monitor's `readMail` into the client's own `watch.mail` with `reader = 'mail'`. Then it emits to the client's `mail` workflow, where `clientTriageStep` sorts with the Monitor's rules and model and names the client in the prompt. A dead mailbox doesn't stop the others.
- Inbox (`packages/content/src/social/records.ts`): the client's mail shows as type Mail, with sender, subject, summary and the provider's own link. Done clears it. Wren's own Monitor rows never show there.
- Tables (migration 0184): `mail_connections`, `mail_consents` and `mail_grants` on main. `watch.mail` gets `link` and `reader`.
- Services: `MailAccess` (portal routes `mail`, `addMailbox`, `connect`, `consent`, `check`, `done`) and `MailCallback/land` (private, reached only through the portal Worker).

## What William must create

1. Google Cloud OAuth client "Wren mail":
   - type Web application;
   - redirect URI `https://app.wrenautomation.com/oauth/mail/google`;
   - consent screen External, scopes `openid`, `email`, `gmail.send`, `gmail.readonly`;
   - publish it. Unverified means a warning and a cap of 100 users. Trusted domains skip the warning. Sending-only verification has no CASA review.
2. Microsoft Entra app "Wren mail":
   - multi-tenant (any organizational directory);
   - redirect URI (Web) `https://app.wrenautomation.com/oauth/mail/microsoft`;
   - delegated Graph permissions `Mail.Read`, `Mail.Send`, `offline_access`, `openid`, `email`;
   - one client secret.
   - Publisher verification is worth doing, so admins see a verified name.
3. Secrets: don't add the ids and secrets to the SSM env parameter; it's near its 8 KB cap. Put them in the key store under the client `wren`: `wren keys put wren MAIL_GOOGLE_CLIENT_ID` (value on stdin), and the same for `MAIL_GOOGLE_CLIENT_SECRET`, `MAIL_MICROSOFT_CLIENT_ID` and `MAIL_MICROSOFT_CLIENT_SECRET`. The env names `WREN_MAIL_*` also work for local runs.
4. The key store's infra steps (`designs/2026-10-07-key-store.md`) cover mail too. No `owners/*/keys/*` grant and no `WREN_KEY_STORE`: both are gone. Until the store is up, Connect says Wren's key store isn't set up yet.

## Left

- Done for you: an autobrowse `do` walk for both admin consoles. It needs a real test Workspace and tenant to build against.
- Start `MailReader/all` and `SetupWatch/all` on prod after the apps exist. Sell `mail.triage` per client.
- Google push (Pub/Sub watch) and Graph subscriptions, if 15 minutes is too slow. Both cost setup, not money.
- Replying from the Inbox through the connected mailbox (the send scope is already granted).

## Open questions

- Google CASA: worth it only if personal-Gmail clients need reading. Today they get send only.
- Should a client's Microsoft consent cover only some mailboxes (application access policy)? Not needed for delegated scopes.

## Decision log

- 2026-10-07: tokens and Wren's mail apps moved from SSM owner paths to the one key store (`designs/2026-10-07-key-store.md`, "One store, not two"). No prod data existed to move.

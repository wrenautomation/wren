---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-07 @ 29aa22e6
entity: packages/channel-email/src/access/schema.ts:71
---

# mail access (a client's connected mailboxes)

A client's own mailbox, connected by one sign-in so Wren can send from it, and read it once the domain's admin trusts Wren's Google app or consents to Wren's Microsoft app. Rows: `mail_connections`, `mail_consents`, `mail_grants` (designs/2026-10-07-mail-access.md).

## Why this shape

Per-mailbox 3-legged OAuth on a trusted app, never domain-wide delegation: Wren holds only what each person granted, for their own mailbox. Trust or consent is a fact on the domain's account (`google_workspace`, `microsoft_365`); the token is a fact on the `mailbox` account, so the setup engine checks, alerts and restarts them like any other. Refresh tokens live in the key store, never in Postgres; a connection row keeps only the key's name.

## Shape

- `mail_grants` (`schema.ts:37`): one-time OAuth `state` + PKCE verifier, kind connect (30 min) or consent (7 days); spent by `MailCallback/land`, swept by the reader's pass (`sweepGrants`, `access.ts:705`)
- `mail_connections` (`schema.ts:71`): one per mailbox account; provider, address, org (hd or tenant id), scopes, access send/read, `token_name`, state connected/broken with `why`
- `mail_consents` (`schema.ts:111`): one per `microsoft_365` account; the tenant id the admin consented in
- Token key: `/wren/<env>/owners/<client>/keys/MAIL_<PROVIDER>_<16 hex>` (`tokenName`, `access.ts:86`), JSON `{refresh, address}`; Wren's app ids at `/wren/<env>/owners/wren/keys/MAIL_*` or `WREN_MAIL_*` (`mailAppsFrom`, `access.ts:718`)
- OAuth (`oauth.ts`): `scopesFor` (`:29`), `connectUrl` (`:67`, PKCE, Google `hd`, Microsoft tenant in path), `consentUrl` (`:108`, v2 adminconsent), `exchange`/`refresh` (`:206`/`:224`), `appInTenant` (`:243`, AADSTS700016 = not consented)
- Mailboxes (`mailbox.ts`): `gmailMailbox` (`:44`) and `graphMailbox` (`:116`) as core's `Mailbox`, so the Monitor's `readMail` reads them
- States (`mailboxStates`, `access.ts:143`): not_set_up, waiting_admin, send_only, read_send, broken; personal Gmail sends only, personal Outlook refused
- Setups (`setups.ts`): `setup.google_mail` (app, trust), `setup.microsoft_mail` (app, consent), `setup.mailbox` (connected); checks `mailChecks` (`:110`): `mail.google_app`, `mail.microsoft_app`, `google.mail_trust` (a real read), `microsoft.admin_consent`, `mailbox.token`
- Services: `MailAccess` (`console.ts:234`; routes `console-routes.ts:8`) and `MailCallback/land` (`console.ts:310`, private; the portal Worker's `/oauth/mail/<provider>` forwards to it, `apps/portal/src/mail-oauth.ts`)

Citations: `packages/channel-email/src/access/schema.ts:37`, `:71`, `:111`; `packages/channel-email/src/access/access.ts:86`, `:143`, `:265`; `apps/worker/src/services.ts:1337`

## Connected to

- **owns:** its grants and consents
- **owned-by:** [[platform/account-setup]] (`client_accounts` rows of site `mailbox`, `google_workspace`, `microsoft_365`)
- **joins:** [[watch/mail]] (the `MailReader` reads connected read mailboxes into the client's `watch.mail`, `reader = 'mail'`)
- **looks-like-but-is-not:** [[email/transport]] (Wren's own cold-email senders); the Monitor's mailboxes (William's, from `mailboxes` in SSM)

## If you change this

- **Hits:** Account → Mail (`apps/portal/web/src/modules/account/Mail.tsx`), the setups' checks, the reader, migration 0179
- **Does not hit:** Wren's own sending inboxes, the Monitor's own mail

## Surfaces

| Surface | Role |
|---|---|
| Account → Mail (client owners and admins; Wren's team for any client) | reads, writes (add, connect, consent link, check) |
| `/oauth/mail/google`, `/oauth/mail/microsoft` (portal Worker) | writes (lands a grant) |
| SetupWatch and the spine's `setup.step` | checks facts |
| `MailReader/all`, every 15 min | reads tokens, marks broken |

## See

- Source: `packages/channel-email/src/access/`
- Design: `designs/2026-10-07-mail-access.md`

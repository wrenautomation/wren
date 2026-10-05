# Mailbox fleet: SMTP sends, text-only openers, domain health, placement (2026-10-04)

## Answer first

- Nine new inboxes on three new domains (autobrowse `inbox-fleet`): `wren-automations.com` and `wrenautomationteam.com` on Google, `getwrenautomation.com` on private SMTP. Inbox Insiders owns their tenants, so Gmail domain-wide delegation cannot reach them. wren sends over SMTP and reads replies over IMAP.
- Every opener goes out as one `text/plain` part: no HTML, no pixel, no link code. Follow-ups keep today's form.
- Each new inbox gets its own ramp in the roster: 1 a day, +1 each send day, to 30. Nine inboxes at 30 is about 270 a day, near William's 300.
- The morning digest checks every sending domain, the main site and the signature domains against Spamhaus DBL, SURBL and URIBL. It also checks their NS, MX, SPF, DMARC and DKIM, and the SMTP host's IP on the five IP lists the prober check uses. Problems post to Discord as a warning.
- Once a day each new inbox sends one short plain message to each of William's personal seed inboxes. Next morning the digest says where each landed (inbox, promotions, spam, missing). Seeds are only read: never marked, moved or answered.
- Cost: $0 in wren. nodemailer and imapflow are free. Lookups are DNS.

## 1. Logins: autobrowse writes, wren reads

autobrowse's `credentials` step already stores `smtp@<email>` and `imap@<email>`. It also writes one SecureString, `/wren/prod/mailboxes`:

```json
{ "a@getwrenautomation.com": { "smtp": { "host": "…", "port": 465, "user": "…", "pass": "…" }, "imap": { … } } }
```

The step reads the parameter, merges, and writes it back. It never logs a value. Google inboxes come from the CSV on Inbox Insiders' orders page and go in as `smtp.gmail.com:465` and `imap.gmail.com:993`. If the CSV has no app passwords, see Open below.

The Lambda pulls the parameter at cold start beside the roster: `loadSsmFile(WREN_SSM_MAILBOXES_PARAM, "/tmp/mailboxes.json")`. That is one more KMS read per cold start. Locally, `WREN_MAILBOXES_FILE` names a file.

## 2. Roster

Two optional keys per sender in `senders_config.toml`:

```toml
[[senders]]
address = "william@getwrenautomation.com"
display_name = "William Jin"
transport = "smtp"                       # default "gmail"
ramp = { start = "2026-10-20", from = 1, step = 1, ceiling = 30, warmup_start = "2026-10-06" }
```

- `transport = "smtp"` needs a row in the mailboxes file. If it is missing, that is a `RosterError` at load, never a skip.
- `ramp` replaces the fleet ramp for that inbox only. `start` is the first day it sends cold. That is William's call, after at least 14 days of warmup. With no `ramp`, the fleet ramp applies as today. `warmup_start` is the day Instantly warmup went on; with it, the inbox's cold sends never pass half that day's warmup (2 to 1).

## 3. Send: `SmtpTransport`

`packages/channel-email/src/send/smtp.ts`, `name = "smtp"`.

- `send` hands nodemailer the bytes `buildMime` makes, so our Message-ID goes out exactly as minted (`raw` message, envelope from `fromAddress` to `to`).
- After the send it appends the same bytes to the mailbox's Sent folder over IMAP. Gmail saves SMTP sends on its own; there it searches first and skips the append. That keeps the thread visible in the inbox and gives `find` something to find.
- `find(sender, messageId)` = IMAP `SEARCH HEADER Message-ID` in Sent. `providerId` = `<uidvalidity>:<uid>`; `threadId` = our Message-ID (IMAP has no thread id; the sync matches on In-Reply-To and References first).
- Failures:

| What | Error |
|---|---|
| connect fails, TLS fails, timeout before `MAIL FROM` | `TransportRefused` |
| 535 auth, 550 sender rejected, 5.7.x policy | `TransportRefused`, `senderLevel: true` (stops this inbox, not the run) |
| 5xx on `RCPT TO` | `TransportRefused` (that lead's address) |
| socket lost or timeout after `DATA` | `TransportAmbiguous`; reconcile looks in Sent |

`RoutedTransport` holds the Gmail transport and the SMTP transport and picks per sender from the roster. It is the only `Transport` the services see. `messages.transport` records the inner one (`gmail` or `smtp`), so reconcile asks the one that sent.

## 4. Read: `ImapReader`

`packages/channel-email/src/inbox/imap.ts`, satisfies `InboxReader`, routed per sender the same way.

- `listMessages` honors `after:<epoch>` from the query and lists INBOX plus the spam folder (`\Junk`, or `[Gmail]/Spam`). Sent and drafts are never listed, so the rest of the Gmail query needs nothing. Ids are `<folder>:<uidvalidity>:<uid>`.
- `getMetadata` returns the Gmail shape the sync already reads: `{ payload: { headers }, internalDate, threadId: null }`.
- `getRaw` = `FETCH BODY.PEEK[]`. It never sets `\Seen`, so William's view of the inbox is untouched.

Bounces, auto-replies and replies then go through the existing `inbox/inbound.ts` unchanged.

## 5. Text-only openers

`buildMime` sends a message with no `inReplyTo` as a single `text/plain; charset=utf-8` part: no HTML twin, no pixel, no `?r=`. This holds on every transport, Gmail included. A bare domain in the signature stays plain text. The new inboxes' signatures name their own domain (the masked site), never the main one.

## 6. Ramp per inbox

`SendPolicy.perInboxCap(now, ramp?)`: a sender's own ramp counts send days from its own `start`, with the same day and holiday rules. `deliver.ts:300` and `:725` and `ComposeScheduler`'s capacity pass the sender's ramp. `describe` prints one line per ramped inbox in the digest: `william@getwrenautomation.com 4/day (day 4 of ramp to 30)`.

Placement sends (section 8) do not count against the cap.

## 7. Domain health in the digest

`packages/channel-email/src/verification/domain-health.ts`, beside `prober-health.ts`, the same `Resolver` seam.

Domains checked: each roster sender's domain, the main site (`wrenautomation.com`), and every domain a signature names. Per domain:

| Check | Pass |
|---|---|
| `dbl.spamhaus.org` | no answer. Listed = `127.0.1.2`–`127.0.1.255`; `127.255.255.x` = refused, reads "not checked" |
| `multi.surbl.org` | no answer. `127.0.0.1` = refused; any other `127.0.0.x` = listed |
| `multi.uribl.com` | no answer. `127.0.0.1` = refused; `127.0.0.2/4/8` bits = listed |
| NS | fleet domains: all `awsdns`; main site: unchanged from the last digest |
| MX | at least one |
| SPF | exactly one `v=spf1` TXT at the apex |
| DMARC | `_dmarc` TXT starting `v=DMARC1` |
| DKIM | a `v=DKIM1` key at `google._domainkey` for Google senders, or at the roster's `dkim` selector |

For SMTP senders, the SMTP host's IP also goes through `ipStanding` (the five IP lists).

One digest line per domain: `getwrenautomation.com ok (dbl, surbl, uribl clear; spf, dkim, dmarc, mx ok; ns route53)`. Any listing or failed DNS check is also a `notify("domain health", …, "warning")`, so it @mentions William. A refused list says "not checked", never "clear".

## 8. Placement seeds

`PlacementScheduler/fleet`, a Restate loop object, daily at the open of the send window:

1. For each sender with a `ramp` and each seed in `WREN_PLACEMENT_SEEDS`, it sends one plain message through the sender's transport. The subject and body are the newest composed opener draft in that sender's campaign, exactly as a lead would get it, so the test reads the real copy. The send never touches the lead's rows or `messages`. With no draft yet, the sender skips that day and the digest says so. The Message-ID is recorded in `placement_checks` (sender, seed, message_id, sent_at, landed, checked_at).
2. Two hours later it asks autobrowse `sites` → `gmail` (`--account <seed>`) to search `rfc822msgid:<id>` with spam included, and reads the labels: `INBOX`, `CATEGORY_PROMOTIONS`, `SPAM`, or not found.
3. It writes `landed`. The digest prints one line per sender: `william@getwrenautomation.com: inbox 2/2`. Any spam or missing result is a warning.

The seeds are William's personal Gmail accounts (jinwilliam.jin@gmail.com, will@williamjin.dev). Both already have autobrowse's Gmail consent. The Gmail API read changes nothing in the seed inbox.

## Build

1. autobrowse: `credentials` writes `/wren/prod/mailboxes`; the Google CSV path.
2. wren: mailboxes loader; roster `transport`, `ramp`, `dkim`; `RoutedTransport`; `SmtpTransport`; `ImapReader`; plain openers; per-inbox ramp. Tests cover the MIME bytes, the failure table (a fake SMTP server), the ramp days, and the IMAP shape against a fake.
3. wren: `domain-health.ts` + digest lines + warning. Tests use a fake resolver for each answer kind.
4. wren: `placement_checks` table, `PlacementScheduler`, digest line. This needs (2).
5. Terraform: `WREN_SSM_MAILBOXES_PARAM` on the Lambda and read rights on it. Apply the whole plan, never `-target` the Lambda.

## Open

- **Google app passwords.** If the Inbox Insiders CSV lacks them, each Google inbox needs 2-Step on and an app password. That is an autobrowse chore on the mailbox's own login. Their tenant may forbid it. Then the fallback is XOAUTH2, which needs their admin. Answered when the CSV arrives.
- **Refused lookups from Lambda.** Spamhaus, SURBL and URIBL refuse big shared resolvers. If the first digest shows "not checked", the lookups move to the prober box's resolver (mailifier, one route). Not built until then.
- **Cold start date.** William sets each inbox's `ramp.start`. Earliest: 14 days after warmup starts.

## Decision log

- 2026-10-04: SMTP and IMAP, not the Gmail API, for the new inboxes. Inbox Insiders owns the tenants, so we have no delegation there. Instantly does warmup only (autobrowse design 2026-10-03).
- 2026-10-04: Logins reach the Lambda as one SSM parameter that autobrowse writes. wren never calls the desk to send, so a sleeping Mac cannot stop a send.
- 2026-10-04: Openers are plain text on every transport (William, 10-04). Follow-ups keep the HTML twin.
- 2026-10-04: The ramp is per inbox in the roster, so new inboxes climb without moving the live one's cap.
- 2026-10-04: Placement reads through autobrowse's Gmail site API, per-account consent. The seeds are personal accounts, so nothing writes to them.
- 2026-10-04: Domain lists = Spamhaus DBL, SURBL, URIBL ("spam checkers, srbl, all the other major ones"). The IP lists stay the five the prober check uses.
- 2026-10-04: Placement sends the real opener draft, not a canned note. Filters judge the words, so a canned note would test the wrong message.
- 2026-10-05: Warmup to cold is 2 to 1 (William, email-infra SOP). Instantly climbs +2 a day to 60, about 30 days; `SendPolicy.perInboxCap` holds a ramp with `warmup_start` to floor(warmup ÷ 2). Ratio, step and limit are settings (`WREN_WARMUP_PER_COLD` 2, `WREN_WARMUP_STEP` 2, `WREN_WARMUP_LIMIT` 60).

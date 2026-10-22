# E-signatures on Documenso, newsletter on Listmonk

2026-10-21. William approved both. Free, self-hosted software only. Nothing here costs money until William says so.

## Answer first

- **E-sign: self-host Documenso.** Wren's Documents app calls its API. Documenso seals the PDF, signs it with our certificate and writes the audit certificate. Wren stores both and shows the status. Built behind config. Documenso does not fit on the database box, so it is not running yet. William picks the host (see RAM).
- **Newsletter: self-host Listmonk.** It runs on the database box (about 45 MB). It holds lists, subscribers and campaigns. It never sends mail. It posts each message to Wren, and Wren sends it from portal@ after `mayMarket`. Listmonk is up on the box. The Wren side runs after the next deploy; until then `Newsletter.send` uses the old loop.
- **customer.io:** nothing in code uses it. Only the 14-day trial from 10-14 exists. Nothing to retire.

## What runs today

| Piece | Today |
|---|---|
| Documents app (`packages/documents`) | Own typed-name flow: consent words and version, IP, agent, sha256 of the PDF, `doc_events`. PDF by pdf-lib with a "Signing record" page. No sealed signature, no outside certificate. |
| Newsletter (`packages/channel-email/src/restate/newsletter.ts`) | `Newsletter` object, one per issue. Loops the confirmed consents, 1 a second, 1,500 a day, through `portalMail` (Gmail API). Plain text only. |
| Lists and consent | `topics`, `consents`, `consent_events` in Wren. Double opt-in on the lander. `mayMarket` gates every send. |
| customer.io | Doc comments only (`designs/2026-10-14-customerio-audit.md`). |

## E-sign: Documenso, not our own

Law first. A US e-signature stands under ESIGN and UETA when it has: consent to use electronic records, clear intent to sign, the signature tied to the record, a record that can be kept and shown again, and proof of who and when. Documenso gives a simple electronic signature (SES) with this. It has no AES or QES. US contracts do not need them.

| Need | Documenso | What Wren adds |
|---|---|---|
| Intent and signature tied to the record | Signing page, fields on the PDF | Placeholders in the PDF we make |
| Tamper evidence | PDF signed with our `.p12` (CAdES, checked in a probe: `/SubFilter /ETSI.CAdES.detached`) | Store the sealed PDF and its sha256 |
| Audit trail: time, IP, email, agent | Audit-log PDF and certificate PDF, both downloadable by API | Store both next to the PDF |
| Consent to electronic records | A line in the document body | `docPdf` prints the line on every PDF |
| Status | Webhooks: sent, opened, signed, completed, rejected, cancelled | Map to `docs.status` and `doc_events` |

Why not our own: sealing a PDF with a certificate, and the audit certificate, are what William said not to build. The own flow stays for simple quotes. "Send for signature" is the sealed path.

Limits to know:

- The certificate is a self-made `.p12`. The seal proves the file did not change. It does not prove who made it, so a PDF reader shows "unknown signer". ESIGN and UETA do not need a trusted chain. A trusted certificate costs money and is William's call.
- Documenso is AGPL-3.0. We run it unmodified as a separate service and talk to it over HTTP. That is fine. Do not copy its code into Wren.

### How it connects

1. `Documents.signature` (new handler): builds the PDF with `{{signature, r1}}` and `{{date, r1}}` placeholders. Documenso turns them into fields (checked in a probe). It creates the envelope with `distributionMethod: NONE`, all Documenso emails off, and distributes. The result holds the signer's link.
2. Wren mails that link from portal@ through `portalMail`. Documenso needs no SMTP.
3. Documenso posts webhooks to the phone Worker, `/webhooks/documenso`. The Worker checks `X-Documenso-Secret` in constant time and forwards to Restate with an idempotency key. No secret set: 503 "webhooks off".
4. `Documents.signed` (new handler) maps the event. On completed it downloads the sealed PDF, the certificate and the audit log. It puts them in the files bucket under `clients/<client>/documents/<doc>/` and sets `docs.sha256` to the sealed PDF's hash.
5. Status map: sent to `sent`, opened to `viewed`, completed to `signed`, rejected to `declined`, cancelled to `void`.

Webhook bodies carry each signer's token. Wren keeps only the event, the status and the envelope id, never the token.

Config (all optional; unset means "e-sign provider is off"): `WREN_DOCUMENSO_URL`, `WREN_DOCUMENSO_TOKEN`, `WREN_DOCUMENSO_WEBHOOK_SECRET` (phone Worker: `DOCUMENSO_WEBHOOK_SECRET`).

## Newsletter: Listmonk with the postback messenger

Listmonk gives lists, subscribers, a campaign editor and a send queue with rate limits. It would normally send through SMTP. Wren needs three things SMTP loses: the per-message `mayMarket` gate, the one-click unsubscribe and signed preference link from `marketingEnvelope`, and the Message-ID that bounce matching uses. So Listmonk sends through its postback messenger to Wren.

Probed on Listmonk 6.2.0:

- A postback is one POST per subscriber, with `campaign.uuid`, `campaign.tags`, `recipients[0].{uuid,email,name}`, `subject` and `body`.
- Plain campaigns still get wrapped in the default HTML template. Wren creates a body-only template `wren plain` and every campaign uses it.
- Listmonk renders the body as a Go template. Wren escapes `{{` in post text.
- Settings are in the database and change through `PUT /api/settings`. Wren applies them (`wren listmonk setup`): messenger `wren`, 1 message a second, 1,500 in 24 hours, tracking off, public pages off.

Flow:

1. `wren newsletter send <slug>` calls `Newsletter.send` (same key `<topic>:<slug>`, same input). It syncs the topic, makes a campaign tagged `issue:<topic>:<slug>` and starts it. `--test` still sends one mail direct. A re-send of the same slug finds the campaign by that tag and does not make a second.
2. Listmonk posts each message to `http://127.0.0.1:8080/ListmonkIntake/post` on the box. Loopback only, no secret.
3. `ListmonkIntake.post` hands each message to the object `ListmonkMail` keyed `<campaign>:<recipient>`, and answers 200 at once. A repeat of the same message does nothing.
4. `ListmonkMail.send` does what the old loop did for one address: skip if the issue already went to it, `mayMarket`, `marketingEnvelope`, send through `portalMail`, `recordMarketingSend` with evidence naming the issue. A skip is not an error. `wren newsletter status` is unchanged.
5. A campaign made in the Listmonk UI works too. Tag it `wren-topic:<topic>`. The issue key is then `<topic>:<campaign name as slug>-<first 8 characters of the campaign uuid>`. A campaign with no topic tag, or an unknown topic, stops with a clear error and sends nothing.

Sync, `ListmonkSync` (loop object, hourly, and on each `Newsletter.send`):

- Wren to Listmonk: one list per email topic, subscribers for every confirmed consent. A consent no longer confirmed becomes `unsubscribed` on that list.
- Listmonk to Wren: a subscriber who is `unsubscribed` or blocklisted in Listmonk, with `subscription_updated_at` later than the consent's last change in Wren, becomes `withdrawConsent`. A later re-confirm in Wren wins. No ping-pong.
- Sign-up stays on the lander. Double opt-in and proof stay in Wren. Listmonk's own sign-up pages are off.

Until Listmonk config is set (`WREN_LISTMONK_URL`, `WREN_LISTMONK_USER`, `WREN_LISTMONK_TOKEN`), `Newsletter.send` uses the old direct loop, and `ListmonkSync` waits (paused, with the reason in the console). Delete the old path once Listmonk has sent one real issue.

Commands: `wren listmonk setup` (settings and template; safe to run again) and `wren listmonk sync` (both ways, now).

## RAM

Measured 2026-10-21.

| Host | Total | Available | Note |
|---|---|---|---|
| Database box `wren-pg` (t4g.small), before Listmonk | 1,841 MB | 280 MB | 526 MB of 2,047 MB swap already used. Restate 462, Postgres 427, worker 228, browser 152 MiB |
| Same box, Listmonk running (10-21) | 1,841 MB | 279 MB | Swap 575 MB. Listmonk 44 MiB (`docker stats`), Postgres 372, Restate 443, worker 236 |
| Each RackNerd VPS | 1 GB | about 545 MB | Mail probers |
| Mac (desk) | 16 GB | n/a | Sleeps, not a host |

| Software | Idle | After work | Source |
|---|---|---|---|
| Listmonk 6.2.0 (Go) | 31 to 34 MiB | same after 2 campaign sends | Mac probe, `--memory 128m`. Its database is a database on the box Postgres. |
| Documenso 2.21.0 (Node) | 399 MiB | 477 MiB after one signing | Mac probe, 1.5 GB cap |
| Documenso's Postgres | 37 MiB | 47 MiB | Mac probe |
| Documenso, from its docs | | | min 1 CPU and 1 GB, recommended 2 CPU and 2 GB |

Result:

- Listmonk fits on the box: 44 MiB measured there, against 280 MB free. It runs with a 128 MB limit.
- Documenso does not fit on the box. It needs about 520 MB with its database. The box would swap harder and hurt Restate and Postgres. It does not fit a 1 GB VPS either: 545 MB free leaves no room for a signing.

### Hosting options for Documenso (William picks; nothing bought)

List prices from memory. Check each before buying.

| Option | Cost | Note |
|---|---|---|
| A. Box to t4g.medium (4 GB) | about +$12 a month | One host. The 10-17 cut to t4g.small saved this. Restate and Documenso share one box. |
| B. New AWS t4g.small or Lightsail 2 GB | about $12 a month | Clean split. Same cloud, same SSM access. |
| C. 2 GB VPS (RackNerd) | about $3 to $5 a month | Cheapest paid. Same host family as the probers. |
| D. Oracle Cloud Always Free ARM | $0 | Free. Needs a new account, and capacity is not guaranteed. William's call on the account risk. |

My pick is C, then D if William wants $0. The code needs only a URL and a token, so the host can change later.

## Migration

1. Listmonk is up on the box (done; see the log below). Settings and template are applied.
2. After the next deploy: start the loop with `ListmonkSync/all/start` on the Restate ingress. `wren listmonk sync` fills the lists now.
3. `wren newsletter send <slug> --test <address>` on our own domain, then the first real issue.
4. After one real issue, delete the direct send path.
5. Documenso: William picks a host, runs `deploy/documenso/` (compose file in this change), sets the three config values, makes the API token and the webhook, and sends one test document to himself.

## Seams

| Seam | Wren | Other side |
|---|---|---|
| Listmonk API | `packages/channel-email/src/listmonk/client.ts` | `https://lists.wrenautomation.com/api` (Caddy to 127.0.0.1:9000) |
| Listmonk postback | `ListmonkIntake`, `ListmonkMail` | Listmonk settings, messenger `wren` |
| Documenso API | `packages/documents/src/documenso.ts` | `WREN_DOCUMENSO_URL` |
| Documenso webhook | `apps/phone/src/worker.ts` `/webhooks/documenso`, `Documents.signed` | Documenso webhook, header `X-Documenso-Secret` |
| Sealed files | files bucket, `clients/<client>/documents/...` | none |

## Outside changes made (log)

Done by the builder on 2026-10-21, outside the repo. Nothing was bought. No mail was sent.

| What | Where | Undo |
|---|---|---|
| New SecureString `/wren/prod/listmonk`: JSON `admin_user`, `admin_password`, `db_password` (random, 28 characters) | SSM | Delete the parameter |
| The same three fields merged into `/wren/prod/cache` (its `password` field is unchanged). The box role cannot read a new parameter until Terraform grants it, and it can read this one. | SSM | After the Terraform apply below, remove the three fields from `cache` and run `box-listmonk.sh` again with the default parameter |
| `wren-box-listmonk` installed in `/usr/local/bin`, run once with `/wren/prod/cache`. It made the Postgres role and database `listmonk` on `wren-pg`, the container env file in `/var/lib/wren-pg/listmonk/` (mode 600) and the container `wren-listmonk` (`listmonk/listmonk:v6.2.0`, host network, 128 MB). | the box | `docker rm -f wren-listmonk`; drop the database and role |
| Block for `lists.wrenautomation.com` appended to `/var/lib/wren-pg/restate/Caddyfile` by hand (copy kept as `Caddyfile.bak-listmonk`), Caddy reloaded, certificate issued. `box-restate.sh` in this change writes the same block. The box copy of `wren-box-restate` is older than main and was not replaced. | the box | Restore the `.bak-listmonk` file and reload |
| DNS: `A lists.wrenautomation.com` to the box address, DNS only (like `restate.`) | Cloudflare | Delete the record |
| Listmonk: API user `wren-api` (Super Admin role, type api). Its token is in `/wren/prod/env-2`. The sample lists and subscribers were deleted. `wren listmonk setup` set the messenger `wren`, 1 message a second, 1,500 in 24 hours, tracking off, public pages off, and made the template `wren plain`. | Listmonk | Remove the user in the admin |
| `/wren/prod/env-2`: added `WREN_LISTMONK_URL`, `WREN_LISTMONK_USER`, `WREN_LISTMONK_TOKEN` by JSON merge. No push-secrets. The parameter is now 4,005 of 4,096 characters (standard tier). | SSM | Remove the three keys |

Needs the owner of the local Terraform state: `tofu import aws_ssm_parameter.listmonk /wren/prod/listmonk`, then `tofu apply` (`deploy/terraform/postgres.tf`). After that the deploy step for Listmonk reads its own parameter.

The workers read `env-2` at start. They pick up the three Listmonk keys at the next deploy.

## For William

- Pick the Documenso host (options above). Then follow `deploy/documenso/README.md`.
- First login to Listmonk at `https://lists.wrenautomation.com/admin`. The admin login is in SSM `/wren/prod/listmonk` (`admin_user`, `admin_password`). Read it with `node scripts/secrets.mjs run /wren/prod/listmonk -- ...`. The admin page is open to the web behind that login only.
- Run the two Terraform commands in the log (import, apply).
- Decide on a trusted signing certificate for Documenso (costs money; optional).
- Keep the Documenso `.p12` passphrase and a copy of the `.p12` in credvault. Losing it does not break old PDFs, but new seals would use a new certificate.
- Read the signing page text in Documenso once and check it is fine for your contracts. Not legal advice. A lawyer should read the contract text.

## Left over

- Client broadcasts (`Broadcast`) stay on their own sender. They send per client from the client's mailbox, and a client's list is not in Wren's Listmonk. Moving them needs one Listmonk list per client.
- `env-2` has 91 characters free. The Documenso keys need a new parameter (`env-3`: a Terraform resource, a grant, a place in the worker's list).
- Plain text only. Listmonk can send HTML. The old rule stands: plain text lands in the inbox.
- customer.io trial from 10-14 lapses by itself. Nothing in code to remove.
- Bounces on newsletter mail are still matched by Message-ID in Wren. Listmonk never sees them. Its bounce screens stay empty.
- The sync reads whole lists. Fine to some thousands of subscribers. Past that, page it.

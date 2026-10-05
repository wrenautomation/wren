# Wren production: what is live and how to run it

Checked 2026-10-03. Companion to `restate-durability.md` (why it survives crashes) and
`deploy/README.md` (setup runbook).

## Where everything runs

| Host | What runs there | Shipped by | Runbook |
|---|---|---|---|
| Restate Cloud, env `wren-automation` (`env_201m2vp6sq3x11xdaatsmjej302`), region `us` | every loop's journal, timers, object state; the ingress | always on, free tier | this file |
| Lambda `wren-prod-worker` (us-east-1, Node 22 arm64, 1 GB, 15 min max) | every service except the box's; one version per push | CI `deploy.yml` | `deploy/README.md` |
| EC2 `wren-prod-pg` (`t4g.small`) | Postgres 17 + browserless Chromium in Docker; the **box worker**: `BOX_SERVICES` (PoolScheduler, Discovery, Enrichment, Resolution, PageArchive, Books) over Restate's tunnel (`WREN_POOL_CHAIN_HOST=box`) | CI over SSM (`deploy/scripts/box-worker.sh`) | `deploy/README.md`, `apps/worker/src/box.ts` |
| RackNerd VPS (192.255.226.241, Buffalo) | mailifier SMTP prober behind Caddy (`probe.wrenautomation.com`) | `deploy/scripts/deploy-prober.sh` | "Verifying addresses" below |
| RackNerd VPS (198.44.104.204, Los Angeles) | second prober (`probe2.wrenautomation.com`); in `WREN_SMTP_PROBE_URL`, probes once its PTR resolves | `PROBE_HOST=probe2.wrenautomation.com deploy/scripts/deploy-prober.sh` | "Verifying addresses" below |
| William's Mac | autobrowse desk worker under launchd: every `sites` call (browser, logins, Chrome profiles, home IP) | `../autobrowse/deploy/desk/install.sh` | `../autobrowse/deploy/README.md` |
| Lambda `wren-prod-auth` + Cloudflare Workers | sign-in (`apps/auth`), phone (`apps/phone`), portal (`apps/portal`) | CI `deploy.yml` | `deploy/phone.md`, `deploy/portal.md` |
| Cloudflare Worker + D1 | open pixel `t.wrenautomation.com` (tracking off) | by hand, `wrangler deploy` | `deploy/pixel/README.md` |
| Cloudflare Pages | the lander (`../lander`) | push to lander `main` | `../lander/README.md` |

Secrets: one SSM SecureString `/wren/prod/env` (from `deploy/prod.env`) read at cold start;
the roster is SSM `/wren/prod/senders_config` (from `senders_config.toml`). Model calls in
prod use `WREN_LLM` (paid Cohere); `WREN_POOL_MODEL_STAGES=none` keeps the pool chain off it.

Prod from this laptop, from the repo root (nothing secret is printed):

```sh
node scripts/prod-sql.mjs "SELECT ..."                 # read-only query (READ ONLY transaction)
node scripts/ingress.mjs PoolScheduler/recruiting/status   # any handler; writes too, so read it first
node scripts/prod-wren.mjs <cmd>                        # the wren CLI against the prod database
restate invocations list --service Enrichment --key recruiting   # stuck work; cancel with `restate invocations cancel --yes <id>`
```

```
you / CLI / curl ──ingress :8080, API key──▶ Restate Cloud (journal, timers, object state)
Restate Cloud ──assume wren-prod-restate-invoker──▶ Lambda wren-prod-worker
Restate Cloud ──tunnel──▶ box worker (EC2) and desk worker (Mac)
Lambda, box ──TLS 5432──▶ Postgres on EC2
Lambda, box ──CDP :3000──▶ browserless
Resolution (box) ──HTTPS──▶ prober (RackNerd) ──port 25──▶ mail servers
Lambda ──Gmail API (domain-wide delegation)──▶ Gmail
GitHub Actions (main) ──OIDC role──▶ Lambda versions, box worker, Cloudflare Workers
```

Restate Cloud is the only always-on piece. It holds every loop's timer and
state. Lambda runs only when Restate invokes it, so a loop asleep for 14 hours
costs nothing and has no process to crash.

## AWS resources (24, all Terraform in `deploy/terraform/`)

| Resource | Job | ≈ cost/mo |
|---|---|---|
| EC2 `t4g.small` (AL2023 ARM) | Postgres + browserless in Docker | $12 |
| EBS gp3 20 GB | DB data, survives instance rebuild | $2 |
| Elastic IP | fixed DB address | $0 while attached |
| Security group | 5432 (TLS Postgres) and 3000 (browser, token) only | $0 |
| S3 bucket | nightly `pg_dump -Fc`, 30-day lifecycle | pennies |
| Lambda `wren-prod-worker` + log group | the worker | ≈ $0 at this volume |
| SSM params `/wren/prod/{pg_password,browser_token,env}` | secrets | $0 |
| IAM: instance role, Lambda role, `wren-prod-restate-invoker`, `wren-prod-ci` + GitHub OIDC provider | who may do what | $0 |

Total ≈ $15/month. Restate Cloud is on the free tier.

## Operating

### Ingress (any HTTP client; API key from Developers → API keys)

No input: send no body and no content type. A body: `content-type: application/json`. A handler with an input schema refuses an empty body typed as JSON; `ingressOf` and `scripts/ingress.mjs` already send nothing for no input.

```sh
H="Authorization: Bearer $RESTATE_AUTH_TOKEN"     # in wren/.env
U=https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080

curl -X POST -H "$H" $U/SendScheduler/alice@example.com/status
curl -X POST -H "$H" $U/SendScheduler/alice@example.com/start
curl -X POST -H "$H" $U/SendScheduler/alice@example.com/stop
curl -X POST -H "$H" $U/InboxScheduler/alice@example.com/sync
curl -X POST -H "$H" $U/PostmasterScheduler/fleet/start
curl -X POST -H "$H" $U/OpensScheduler/fleet/start
curl -X POST -H "$H" $U/ReportScheduler/weekly/start   # Friday 19:00 report; /sync mails one now
curl -X POST -H "$H" $U/ComposeScheduler/agencies/start # keep 3 send days of approved openers queued; /sync tops up now
curl -X POST -H "$H" $U/DigestScheduler/fleet/start     # 07:00 fleet-clock digest to Discord; /sync posts one now
curl -X POST -H "$H" $U/Evolution/fleet/start          # 08:00 tick of every running copy experiment (`wren evolve status`), Cohere candidates when due (`wren evolve candidates`); idle with none
curl -X POST -H "$H" $U/PlacementScheduler/fleet/start  # each ramped inbox's newest opener to WREN_PLACEMENT_SEEDS at the window's open; labels read 2 h on
curl -X POST -H "$H" $U/ContentScheduler/default/start  # post approved content drafts as they come due (`wren content queue start`)
curl -X POST -H "$H" $U/ContentMetrics/default/start    # daily metrics snapshots of young posts; Monday what-worked (`wren content metrics start`)
curl -X POST -H "$H" $U/AdsWatch/default/start          # daily ads guard: pauses a launch over WREN_ADS_PAUSE_AFTER_USD with no clicks/results (`wren ads watch start`)
# `Ads` is a plain service (no scheduler): `wren ads launch|start|stop|insights` call it through the ingress; it writes `ad_launches`.
```

### CLI (already configured for this env)

```sh
restate services list                 # the 13 services and revisions
restate invocations list              # running and sleeping loops, with wake times
restate invocations describe <id>     # one invocation's journal
restate services status SendScheduler # per-key state
restate deployments list
```

The Cloud UI (Overview → service → Playground) calls any handler from a form;
Invocations shows every sleeping loop and when it wakes.

### Logs

```sh
aws logs tail /aws/lambda/wren-prod-worker --since 1h --follow
```

Cold start prints one summary line: llm, verifier, renderer, transport,
sender count. `senders: 0` until cutover.

### DB box

```sh
cd deploy/terraform
aws ssm start-session --target "$(tofu output -raw pg_instance_id)"   # shell, no SSH keys
# on the box: docker ps; tail /var/log/wren-user-data.log; tail /var/log/wren-pg-backup.log
```

Migrations from a laptop (URL never echoed):

```sh
WREN_DATABASE_URL="$(cd deploy/terraform && tofu output -raw database_url)" pnpm db:migrate
```

### Deploying a change

Push to `main` → `ci` green → `deploy.yml`: migrations against prod, build
zip, publish a new Lambda version, register it with Restate. Old versions keep
serving in-flight invocations; new invocations go to the new version. When
`restate invocations list` shows none on the old deployment, remove it.

GitHub environment `production` secrets: `AWS_DEPLOY_ROLE_ARN`,
`AWS_INVOKE_ROLE_ARN`, `LAMBDA_NAME`, `WREN_DATABASE_URL`, `RESTATE_HOST`,
`RESTATE_AUTH_TOKEN`. Mirror: `deploy/github-secrets.env`.

### Changing env vars

Edit `deploy/prod.env`, run `deploy/scripts/push-secrets.sh`, then
`gh workflow run deploy.yml --ref main`: it publishes a new Lambda version and
registers it, so every instance cold-starts and re-reads SSM. (Bumping `$LATEST`'s
description does not recycle a published version's instances; Restate invokes
`:N`, not `$LATEST`.)

## The campaign, end to end

Nothing is by hand once a niche has leads. `ComposeScheduler/{niche}` runs once a day
(local midnight): capacity = active inboxes × today's per-inbox cap; it keeps
`WREN_COMPOSE_DAYS_AHEAD` (3) days of approved openers queued, composing the shortfall
through the niche's enrollment plan (`packages/niches/src/<niche>.ts` `plan`: agencies
route by `agency_facts.segment`, marketing → `marketing-days-0-5`, build →
`build-days-0-5`, unsegmented → marketing). Every draft is auto-approved and pins the
sign-off with the niche's page (`/agencies`, `/ria`), so the copy and the site agree.
`SendScheduler/{inbox}` sends them inside the window at the ramp; `InboxScheduler`
reads replies and bounces; kill switches pause a domain at 2% bounces. `status` on the
compose object shows the last pass: `queued`, `target`, `enrolled`, `exhausted` (pool
empty: import more leads or verify more addresses).

## Feeding the pool

`exhausted: true` on the compose object means every company with a sendable
address is enrolled. Growth is the research chain. `PoolScheduler/{niche}` walks
it: one bounded call per stage per pass, another pass a minute later while any
stage still finds work, then sleep until the next local day. What may call the
model is `WREN_POOL_MODEL_STAGES`: `none` (default — discover, crawl, render, scan
only; no verdicts, so no new leads yet), `pick` (one model call per company with
more than one address; this is what turns role inboxes into leads), `all`
(extraction too, one call per stored page — the expensive one).
`WREN_POOL_PROFILES=true` adds `profiles`: LinkedIn pages of the people compose
reaches in the next week, read from Exa's cache through autobrowse `web` (metered;
Google at most 200/day, 8–20 local), then recomputes the firm's lead checks. `wren enrich profiles --niche <n>` runs it by hand; `wren enrich checks --niche <n>` recomputes the checks alone (free, no calls).

```sh
curl -X POST -H "$H" $U/PoolScheduler/sec_ria/start    # /status shows per-stage progress and errors
curl -X POST -H "$H" $U/PoolScheduler/agencies/start
# Only some stages for a niche (applies from the next pass; kept until changed):
curl -X POST -H "$H" -H 'content-type: application/json' $U/PoolScheduler/sec_ria/start \
  -d '{"stages":["resolveMailboxes","verifyMailboxes"]}'
# ...and back to every enabled stage: -d '{}' 
```

`stop` is an exclusive handler: it runs after the pass in flight, so on a long pool
pass the request waits. To interrupt now, `restate invocations cancel <the loop
invocation>` (its children stop with it), then `stop`, then `start` when ready.

A discovery or verification miss is written to `discovery_attempts` (outcome:
`no_candidate`, `unreachable`, `gate_rejected`, `no_name`) and keeps that company out of
the queue for 30 days, so a head of unguessable names never blocks the rest.

The stages by hand, keyed by niche (`all` = every niche); each reports what it moved:

```sh
curl -X POST -H "$H" -H 'content-type: application/json' $U/Discovery/sec_ria/discover -d '{"limit":10}'   # name → domain, DoH + homepage gate, free; one unit per company
curl -X POST -H "$H" -H 'content-type: application/json' $U/Discovery/sec_ria/verify   -d '{"limit":10}'   # prove asserted domains, free
curl -X POST -H "$H" $U/Enrichment/sec_ria/crawl   -d '{"limit":10}'   # homepage + contact/team pages
curl -X POST -H "$H" $U/Enrichment/sec_ria/render  -d '{"limit":10}'   # JS shells, through the CDP box
curl -X POST -H "$H" $U/Enrichment/sec_ria/scan    -d '{}'             # addresses in stored pages, deterministic
curl -X POST -H "$H" $U/Enrichment/sec_ria/extract -d '{"limit":20}'   # people + roles, one model call per page (Cohere)
curl -X POST -H "$H" $U/Enrichment/sec_ria/applyExtractions -d '{}'
curl -X POST -H "$H" $U/Enrichment/sec_ria/pick    -d '{"limit":50}'   # best send-to per company; a model call only when ambiguous
curl -X POST -H "$H" $U/Enrichment/sec_ria/applyPicks -d '{}'          # role inboxes → leads (compose picks them up next pass)
curl -X POST -H "$H" $U/Resolution/default/verifyLeads -d '{"niche":"agencies","limit":10}'  # ask the mail servers about new leads
curl -X POST -H "$H" $U/Resolution/default/build; …/queue   # person guesses (pattern proving), by hand
```

Pool on 2026-09-20: agencies 5,277 companies without a domain, 471 crawled with no
sendable address (42 of them person guesses); sec_ria 19,237 domains, 5 crawled.
Resolution's build/queue stays by hand. `resolve` refuses at ingress (paid credits): queue, never call it.

## Verifying addresses (our own prober)

Every bounce so far was an unverified role inbox. Since 2026-09-21 verdicts come
from our own SMTP prober, not MillionVerifier: it asks the address's MX
`RCPT TO:` and hangs up before `DATA` — no mail is ever sent. Free, so the
pool-feeder runs it as its last stage (`verifyMailboxes`, 192 leads a pass, 32 at once) and
compose enrolls a role inbox only once it holds a `valid` or `catch_all` verdict.
A `risky` verdict (greylist, tarpit) is tried again after two days.

The handshake itself is not wren's: it lives in **mailifier**
(github.com/wrenautomation/mailifier, `npm i mailifier`), and wren plugs it into
the `EmailVerifier` port in one file, `verification/mailifier.ts`. Port 25 is
closed from Lambda and AWS refused to open it on EC2, so the prober
is that package's own server on a RackNerd VPS (192.255.226.241, Ubuntu 24.04,
$21.99/yr, key-only SSH as root with `~/.ssh/wren_probe`, also in SSM
`/wren/prod/probe_ssh_key`). Docker compose runs it behind Caddy, which holds the
TLS for `https://probe.wrenautomation.com` (`deploy/prober/`). The worker reaches it
through `WREN_VERIFIER=smtp` + `WREN_SMTP_PROBE_URL` + `WREN_SMTP_PROBE_TOKEN`
(`deploy/prod.env`; the same token is SSM `/wren/prod/probe_token`).

```sh
deploy/scripts/deploy-prober.sh                      # pinned mailifier + compose + Caddyfile → VPS, restart
deploy/scripts/push-secrets.sh                       # env with the prober URL + token
gh workflow run deploy.yml --ref main                # worker re-reads env
curl -s https://probe.wrenautomation.com/healthz     # {"ok":true,"port_25":true}
```

The A record `probe.wrenautomation.com` (Cloudflare, DNS only) points at the VPS.
Reverse DNS is RackNerd's and ticket-only (the ctrl panel's rDNS button says so):
#EF57722 for 192.255.226.241, #TA25613 for 198.44.104.204 (check with `dig -x <ip>`).
Both boxes share the SSH key, ufw (22/80/443 only), key-only root login and
unattended upgrades; box 2's root password is SSM `/wren/prod/probe2_root_password`. Each box's name is also its HELO and MAIL FROM domain
(`postmaster@<host>`), so each name has an SPF TXT naming only its own IP
(`v=spf1 ip4:<ip> -all`).

Several probers: `WREN_SMTP_PROBE_URL` takes a comma list, one token for all.
Each recipient domain always goes to the same box first (rendezvous hash on the
domain, `ProbeFleet` in `verification/mailifier.ts`), so a mail server sees one IP
at half the pace. When that box's IP is refused (`blocked`, `no_ptr`,
`unreachable`) or the box is down, the other asks once; greylisting stays on its
first box. Each verdict carries `raw.prober`. A second box deploys with
`PROBE_HOST=probe2.wrenautomation.com deploy/scripts/deploy-prober.sh`. Only boxes
whose PTR names them probe (checked hourly per Lambda instance); with none, the first
listed probes alone. So a new box can join the list at once and starts on its own
when its PTR lands. The morning digest checks
each box: PTR, five blocklists, and the share of checks refused for our IP
(warning past 10% of 100+). The canary re-checks every ten minutes; with port 25
closed `/verify` answers 503 and the pool stage retries hourly.

Throughput: the pool-feeder's two mailbox stages run `PROBE_WIDTH` (32) walks at
once and the prober admits `PROBE_MAX_IN_FLIGHT` (64): the slack holds probes a
timed-out client left running, so they never push the next pass into 429. The prober paces each MX host
with a 1.5 s gap: one conversation at a time, 3 for the big shared hosts (Google,
Microsoft, Proofpoint, Mimecast; `PROBE_BIG_HOST_LANES`). Measured 2026-09-25 at 16
wide: ~1,000 domains an hour, VPS load near 0. A host that takes no connection on any
MX name is left alone for an hour; probes queued behind it answer `unreachable` at once.
A probe the client gave up on (60 s) is `risky` `timeout` and the pass goes on.
`resolveMailboxes` walks only the person guesses someone queued (`Resolution/default/queue`).

Meaning of the verdicts: `valid` = the MX accepted the address and refused a random
one; `catch_all` = it accepts anything (sendable, unproven); `invalid` = user
unknown (lead → undeliverable); `risky` = greylisted, blocked or unreachable. Google
Workspace and Microsoft 365 answer honestly; consumer Yahoo refuses probes.

### Importing new companies and people

New firms enter through `wren email import` from the laptop (the DB URL from
`tofu output -raw database_url`). `wren email formats` lists every format and its
owner niche; the format decides the niche, `--niche` is only for the generic `csv`.

```sh
wren email import roster.csv --format sec-investment-advisers          # SEC monthly roster (cp1252 CSV)
wren email import IA_FIRM_SEC_Feed_09_02_2026.xml.gz --format sec-firm-feed   # daily feed: all WebAddrs, streamed
wren email import data/agencies/clutch/design_agencies --format clutch-pages  # a directory of hand-saved pages = one batch
wren email import data/agencies/shopify/store_setup --format shopify-pages    # + fetched profiles under data/agencies/bulk/
wren email import export.csv --format agency-directory-csv                    # manual Clutch/DesignRush/Sortlist export
wren email import leads.csv --format csv --niche agencies --map "Company=company_name"
wren email import maps.csv --format google-maps --niche <niche>               # gosom/google-maps-scraper CSV
wren email import-people ADV_Filing_Data_20260701_20260731.zip --format adv-filing-data   # owners, officers, CCOs
wren email import-people linkedin-ria-founder.csv --format linkedin --niche <niche>  # autobrowse `people --enrich`
```

Directory hosts (clutch.co, shopify.com, …) are platform domains in every import: a
listing URL is kept as the company's social URL, never as its domain; a firm with no
real domain keys by `clutch:<slug>` / `crd:<n>` and gets a domain later from discovery.

Local businesses come from Google Maps through the MIT
[gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper), run by hand
or by `autobrowse maps "<search>"` (starts it, writes the CSV, stops it)
(port 8090: Restate owns 8080). Keep `-c` at 2 to 4 without proxies; empty results
mean slow down.

```sh
docker run --rm -v "$PWD/data/maps:/gmapsdata" -p 127.0.0.1:8090:8080 \
  gosom/google-maps-scraper -data-folder /gmapsdata -c 2    # UI + /api/v1/jobs at :8090
```

Download a job's CSV and import it. `title` becomes the company name, the first of
`emails` the general inbox; a listing with no real website keys by `gmaps:<cid>`.
LinkedIn people come from `autobrowse people` (Wren's LinkedIn; `--enrich` adds the
employer's website, which keys the company, else `li-co:<handle>`; the person keys by
`li:<vanity>`). Directory pages are saved by hand: none of these formats fetches. The publisher files
come through `wren fetch` (needs `WREN_FETCH_CONTACT`; lands under
`<data>/<niche>/bulk/<dataset>/`, skips what is already there, so re-running resumes):

```sh
wren fetch list
wren fetch get firm-feed                      # today's IA_FIRM_SEC_Feed → import --format sec-firm-feed
wren fetch get adv-filing-data --months 2     # newest monthly zips → import-people --format adv-filing-data
wren fetch get shopify-partner-profiles       # profiles for slugs under data/agencies/shopify; 3–8 s apart, stops on a challenge page
```

## Checking the fleet

```sh
wren email senders list                 # roster + pauses
wren email senders check [--niche x]    # mints each inbox's delegation token; exit 1 on any failure
wren email senders check --send         # plus one test mail per inbox to the next inbox in the fleet (nothing leaves the fleet)
```

## Reviewing by hand

Drafts are auto-approved today, so this seat is idle until a human reviews copy again
(or a step fails and needs re-arming). Everything reads the stored text; nothing here
sends.

```sh
wren email drafts [--enrollment N] [--flagged]   # waiting drafts, "via scraped · valid" per address, DUP? flags
wren email show 123                              # full text, address provenance, source page, review history
wren email approve 123 124                       # explicit ids may also re-arm a FAILED step
wren email approve --enrollment 7 | --all        # draft-only; a stopped enrollment's steps are refused
wren email reject 123 --reason too_salesy --note "opener too pushy"
wren email edit 123                              # $VISUAL/$EDITOR; original pinned in provenance.review
wren email stop --enrollment 7 --reason manual --detail "asked on LinkedIn"
wren email stop --company-domain acme.example --reason opt_out
wren email preview build/opener --niche agencies [--variants]
wren email replies                               # #id per reply
wren email event 42                              # one inbox event + which message/address it answers
wren email reply --event 42 --disposition not_now            # relabel
wren email reply --enrollment 7 --disposition interested --note "called back"   # a reply that never hit the mailbox; stops the company
```

Reject reasons: wrong_fact, too_salesy, generic_opener, bad_tone, wrong_person,
bad_address, other. Stop reasons: reply, bounce, opt_out, complaint, manual (opt_out /
complaint / bounce also write the suppression). Answering a reply is done from the inbox.

## The open pixel

`t.wrenautomation.com` is a Cloudflare Worker + D1, source and deploy steps in
`deploy/pixel/`. Tracking is off (`WREN_OPEN_TRACKING`); `OpensScheduler/fleet` pulls
hits whenever `WREN_PIXEL_BASE_URL` and `WREN_PIXEL_EXPORT_TOKEN` are set.

## Discord (what you get told, and what you never get told)

`WREN_NOTIFY=discord` + `WREN_DISCORD_WEBHOOK_URL` (in `deploy/prod.env` → SSM; the URL
authorises posting, so it is a secret). Counts only, never a reply's text or a lead's
address:

One Discord channel per sales channel, so their data stays apart. Each
`WREN_DISCORD_<LANE>_WEBHOOK_URL` unset falls back to the main webhook, which keeps
the digest and system pings (token renewal, audit seals):

| Lane | Setting | Loops |
|---|---|---|
| email | `WREN_DISCORD_EMAIL_WEBHOOK_URL` | send, inbox, compose, warm replies |
| sms | `WREN_DISCORD_SMS_WEBHOOK_URL` | SMS sender, events, desk, watch |
| reach | `WREN_DISCORD_REACH_WEBHOOK_URL` | Reddit/LinkedIn DMs |
| ads | `WREN_DISCORD_ADS_WEBHOOK_URL` | AdsWatch |
| content | `WREN_DISCORD_CONTENT_WEBHOOK_URL` | content scheduler, metrics, planner |
| search | `WREN_DISCORD_SEARCH_WEBHOOK_URL` | SearchWatch, SearchWeek |
| clients | `WREN_DISCORD_CLIENTS_WEBHOOK_URL` | DeliveryWatch, reactivation |

Lander intake has its own channel too: the lander's `DISCORD_WEBHOOK`. autobrowse
`discord-layout` makes the server's categories, channels and these webhooks.

Pings vs. reports. `level` decides who gets a push:

| Level | Means | Discord |
|---|---|---|
| `info` | routine report (digest, SMS today, content posted, search week, ads week, tokens renewed, recovered) | posted @silent |
| `action` | someone waits on William (new reply, warm reply to approve, call booked, inbound text, client message) | @mentions him |
| `warning` | something broke or stopped (loop failed, bounces, kill switch, dry pool, ad to pause) | @mentions him |

`WREN_DISCORD_PING_USER_ID` is his Discord user id; unset, pings post loud with no mention.
The server's default is "only @mentions", so a silent report never buzzes a phone.
Lander leads always @mention him (`DISCORD_PING_USER_ID` Pages secret).


- `N new replies in <inbox>` after an inbox sync that found humans (answer from Gmail).
- `N hard bounces, N unsubscribes via <inbox>` (warning).
- `kill switch paused N inboxes` with sender and reason; `wren email senders resume` lifts it.
- `<niche>: the pool ran dry` from the queue-keeper when the plan has nothing left to enroll.
- `<stage> · <key> failed` once when a loop starts failing, `recovered` once when it stops.
- `digest for YYYY-MM-DD` at 07:00 fleet clock: per domain sent / hard bounces / replies /
  unsubscribes / newest Postmaster spam rate, then the queue.

`WREN_NOTIFY=none` (the default) binds no `DigestScheduler` and every loop stays silent.

## Things to watch

- **Postgres is on the public internet** (TLS-only, scram, 32-byte password)
  because Lambda has no fixed IP and a NAT gateway costs more than the box.
  Rotate: change `pg_password` in `terraform.tfvars`, `tofu apply`, update
  `WREN_DATABASE_URL` in `prod.env`, `push-secrets.sh`, new cold start.
- **Backups are dumps, not point-in-time.** 08:00 UTC daily. A bad write at
  14:00 loses up to a day of ledger.
- **Restate invoker trust policy** came from `@restatedev/restate-cdk`
  (account `654654156625`, role `RestateCloud`, external id = env id) because
  the Cloud UI showed none. If Restate rotates that principal, registration
  breaks with an AssumeRole error; re-check the CDK package or UI.
- **AWS account.** IAM user + MFA + budget done. Use the IAM user for the CLI
  (`aws login` as that user, or an access key + `aws configure`), keep root
  for billing only.
- **Terraform state is local** (`deploy/terraform/terraform.tfstate`,
  gitignored). Back it up with the other private files; losing it means
  importing 24 resources by hand.

## Where things are

| | |
|---|---|
| Terraform | `deploy/terraform/` — `tofu plan` / `tofu apply` |
| Runbook | `deploy/README.md` |
| Lambda entry | `apps/worker/src/lambda.ts`; services wired in `apps/worker/src/services.ts` |
| Loop primitive | `packages/core/src/restate/loop.ts`; send loop `packages/channel-email/src/restate/send-scheduler.ts` |
| Secrets (gitignored, chmod 600) | `deploy/prod.env`, `deploy/github-secrets.env`, `deploy/terraform/terraform.tfvars`, `.env` |
| CI | `.github/workflows/deploy.yml`, GitHub environment `production` |

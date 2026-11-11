# Wren production: what is live and how to run it

Checked 2026-11-09. The runtime: `designs/2026-11-09-own-runtime.md` (why it survives crashes,
how a call runs). Setup runbook: `deploy/README.md`.

## Where everything runs

| Host | What runs there | Shipped by | Runbook |
|---|---|---|---|
| Runtime (`@wren/runtime`, tables `rt.*` in Postgres) | every loop's journal, timers and object state; the door `https://api.wrenautomation.com` (Caddy checks the bearer) | the box worker, below | this file, `designs/2026-11-09-own-runtime.md` |
| Lambda `wren-prod-worker` (us-east-1, Node 22 arm64, 1 GB, 15 min max) | every service the box does not serve; one version per push | CI `deploy.yml` | `deploy/README.md` |
| EC2 `wren-prod-pg` (`t4g.small`) | Postgres 17, PgBouncer (6432, transaction mode), listmonk and Caddy in Docker; the **box worker**: the runtime's dispatcher and door, its Lambda lane, and `BOX_SERVICES` (LeadPoolFill, CompanySiteFind, CompanyEnrich, Resolution, Enrichment, Discovery, LeadVerify, PageHtmlArchive, BooksClose, BooksDaily, MyMailTriage, SocialActivityRead). Two slots, worker 9080/9081 and door 9090/9091; the new build takes new rows, the old one finishes its pinned rows (`apps/worker/src/box-slot.ts`, `rt.box_builds`) | CI over SSM (`deploy/scripts/box-worker.sh`, `box-front-door.sh`) | `deploy/README.md`, `apps/worker/src/rt.ts` |
| RackNerd VPS (192.255.226.241, Buffalo) | mailifier SMTP prober (`probe.wrenautomation.com`) and SearXNG for the research engine (`search.wrenautomation.com`, bearer SSM `/wren/prod/searxng_token`), both behind Caddy | `deploy/scripts/deploy-vps.sh` | "Verifying addresses" and "Search" below |
| RackNerd VPS (198.44.104.204, Los Angeles) | second prober (`probe2.wrenautomation.com`); in `WREN_SMTP_PROBE_URL`, probes once its PTR resolves. Second SearXNG (`search2.wrenautomation.com`, same bearer): a second search IP and a fallback | `PROBE_HOST=probe2.wrenautomation.com SEARCH_HOST=search2.wrenautomation.com deploy/scripts/deploy-vps.sh` | "Verifying addresses" below |
| William's Mac | autobrowse desk worker under launchd: every `sites` call (browser, logins, Chrome profiles, home IP). It pulls its calls from the door (`/claim`, long-poll) | `../autobrowse/deploy/desk/install.sh` | `../autobrowse/deploy/README.md` |
| Lambda `wren-prod-auth` + Cloudflare Workers | sign-in (`apps/auth`), phone (`apps/phone`), portal (`apps/portal`) | CI `deploy.yml` | `deploy/phone.md`, `deploy/portal.md` |
| Cloudflare Worker + Durable Object | LLM gateway `llm.wrenautomation.com` (`apps/llm-gateway`): every free Gemini, OpenRouter, Cohere key behind one endpoint | CI `deploy.yml`; keys by `scripts/llm-gateway-keys.mjs` | `designs/2026-10-06-llm-gateway.md` |
| Cloudflare Worker + D1 | open pixel `t.wrenautomation.com` (tracking off) | by hand, `wrangler deploy` | `deploy/pixel/README.md` |
| Cloudflare Pages | the lander (`../lander`) | push to lander `main` | `../lander/README.md` |

Secrets: one SSM SecureString `/wren/prod/env` (from `deploy/prod.env`) read at cold start;
the roster is SSM `/wren/prod/senders_config` (from `senders_config.toml`). Model calls in
prod use `WREN_LLM` (`anthropic:haiku`, Claude Haiku 5.5 on Wren's key); `WREN_POOL_MODEL_STAGES=none` keeps the pool chain off it.

Prod from this laptop, from the repo root (nothing secret is printed):

```sh
node scripts/prod-sql.mjs "SELECT ..."                 # read-only query (READ ONLY transaction)
node scripts/ingress.mjs LeadPoolFill/recruiting/status   # any handler; writes too, so read it first
node scripts/prod-wren.mjs <cmd>                        # the wren CLI against the prod database
node scripts/prod-sql.mjs "SELECT id, status, run_at FROM rt.invocations WHERE service = 'Enrichment' AND key = 'recruiting' AND status <> 'done'"   # open calls
node scripts/prod-wren.mjs loops cancel <inv_id>        # cancel one; the calls it waits on stop with it
```

```
you / CLI / Workers / webhooks ──HTTPS, bearer──▶ Caddy (api.) ──▶ door 127.0.0.1:9090/9091 (first healthy slot)
door ──▶ rt.invocations (Postgres) ◀── dispatcher (box worker): claim, lease, retry, timers (run_at)
dispatcher ──box lane──▶ BOX_SERVICES in the same process
dispatcher ──Lambda lane, box instance role──▶ Lambda wren-prod-worker (version pinned per row)
desk worker (Mac) ──HTTPS long-poll /claim──▶ door
Lambda, box ──TLS 6432──▶ PgBouncer ──▶ Postgres on EC2
CLI, migrations ──TLS 5432──▶ Postgres on EC2
Lambda, box ──AWS Invoke──▶ render Lambda wren-prod-render (read, paint, shot)
Resolution (box) ──HTTPS──▶ prober (RackNerd) ──port 25──▶ mail servers
Lambda ──Gmail API (domain-wide delegation)──▶ Gmail
GitHub Actions (main) ──OIDC role──▶ Lambda versions, box worker, Cloudflare Workers
```

The box worker is the only always-on piece of the runtime. Every loop's timer and state are rows
in Postgres. Lambda runs only when the dispatcher invokes it, so a loop asleep for 14 hours costs
nothing and has no process to crash. Restate and Redis ran here until 2026-11-09: their
containers (`wren-restate`, `wren-redis`, `wren-desk-hop`) are stopped with no restart, their data
stays in `/var/lib/wren-pg/{restate,redis}`, and their crons sit in `/etc/cron.retired`. The
desk pulls its calls from the door, so it needs no inbound tunnel.

## AWS resources (24, all Terraform in `deploy/terraform/`)

| Resource | Job | ≈ cost/mo |
|---|---|---|
| EC2 `t4g.small` (AL2023 ARM) | Postgres, PgBouncer, listmonk, Caddy and the box worker in Docker | $12 (free trial to 2026-12-31) |
| EBS gp3 20 GB | DB data, survives instance rebuild | $2 |
| Elastic IP | fixed DB address | $0 while attached |
| Security group | 5432 (TLS Postgres), 6432 (TLS PgBouncer), 80/443 (Caddy: the door) only | $0 |
| S3 bucket | nightly `pg_dump -Fc`, 30-day lifecycle | pennies |
| Lambda `wren-prod-worker` + log group | the worker | ≈ $0 at this volume |
| SSM params `/wren/prod/{pg_password,env}` | secrets | $0 |
| Lambda `wren-prod-turbo-cache` + function URL + bucket `wren-prod-turbo-cache` (30-day expiry) | turbo's shared remote cache for CI and the Mac (`deploy/terraform/turbo-cache.tf`; code `deploy/turbo-cache/deploy.sh`; Mac `node scripts/turbo-login.mjs`). Token `TURBO_TOKEN`, URL `TURBO_API`, both in env-2 and GitHub secrets. Down: turbo uses its local cache | ≈ $0.30 |
| IAM: instance role (invokes the Lambda), Lambda role, `wren-prod-ci` + GitHub OIDC provider | who may do what | $0 |

Total ≈ $27/month.

## Operating

### The door (any HTTP client; the bearer is `WREN_API_TOKEN`, an old name kept)

No input: send no body and no content type. A body: `content-type: application/json`. A handler with an input schema refuses an empty body typed as JSON; `ingressOf` and `scripts/ingress.mjs` already send nothing for no input.

```sh
H="Authorization: Bearer $WREN_API_TOKEN"     # in deploy/prod.env
U=https://api.wrenautomation.com

curl -X POST -H "$H" $U/EmailSend/alice@example.com/status
curl -X POST -H "$H" $U/EmailSend/alice@example.com/start
curl -X POST -H "$H" $U/EmailSend/alice@example.com/stop
curl -X POST -H "$H" $U/EmailInboxRead/alice@example.com/sync
curl -X POST -H "$H" $U/EmailPostmasterPull/fleet/start
curl -X POST -H "$H" $U/EmailClickPull/fleet/start     # hourly: the lander's email-link views into email_clicks (the sent log's "clicked"); the first pass reads all history
curl -X POST -H "$H" $U/EmailBounceRead/all/start      # hourly: marketing email bounces from portal@ and each client's sender; hard ones go on do-not-contact
curl -X POST -H "$H" $U/EmailOpenerFill/agencies/start # keep 3 send days of approved openers queued; /sync tops up now
curl -X POST -H "$H" $U/EmailFleetDigest/fleet/start     # 07:00 fleet-clock digest to Discord; /sync posts one now
curl -X POST -H "$H" $U/EmailPlacementTest/fleet/start  # each ramped inbox's newest opener to WREN_PLACEMENT_SEEDS at the window's open; labels read 2 h on
curl -X POST -H "$H" $U/PostPublish/default/start  # post approved content drafts as they come due (`wren content queue start`)
curl -X POST -H "$H" $U/PostMetrics/default/start    # daily metrics snapshots of young posts; Monday what-worked (`wren content metrics start`)
curl -X POST -H "$H" $U/AdSpendGuard/default/start          # daily ads guard: pauses a launch over WREN_ADS_PAUSE_AFTER_USD with no clicks/results (`wren ads watch start`)
curl -X POST -H "$H" $U/ClientInvoicing/fleet/start        # every 15 min: Wren's own invoices made on the 1st, mailed with their PDF, money in read from Wise (GET only) and matched; the first pass bills every signed client (`wren delivery billing start`)
curl -X POST -H "$H" $U/StripeReconcile/all/start          # daily: each Stripe-connected client's links of 120 days held against Stripe; heals missed webhooks, flags drift; reads Stripe only
curl -X POST -H "$H" $U/SegmentsRefresh/all/start           # every hour: wakes SegmentPass/fleet and each non-demo <client>/fleet (People → Groups kept true, segment/trait/date triggers fired); row triggers wake it at commit too; SegmentPass/<key>/status shows the cursor
curl -X POST -H "$H" $U/TouchToJourney/all/start             # on a new touch and every 15 min: each non-demo workspace's untold touches (follows, comments, DMs...; `fired_at` null) told to the executor for `trigger.touch`, then marked; at least once; TouchToJourney/all/status shows the last pass
curl -X POST -H "$H" $U/ListToJourney/all/start            # every 15 min (5 s while a list has more): people added to an import batch that a live funnel's `sourced` entry names open journeys there; ListToJourney/all/status shows the last pass
curl -X POST -H "$H" $U/NextStepDecide/wren/start                 # every 10 min: open comment drafts and people who wrote back judged by Claude Code on the desk (`claude/ask`, $0; they wait while the Mac is off); logged in `decisions`; WREN_DECIDE=off stops it, $1/day cap (`decide.dailyUsd`); /sync runs one pass
curl -X POST -H "$H" $U/VaultKeyMirror/box/start             # hourly: the operator's API keys mirrored from autobrowse's vault (`sites/keys`) into `vault_keys`; /sync mirrors now; rotate, revoke and spend (`wren accounts key ...`) act on a key and mirror again
curl -X POST -H "$H" $U/VariantsCollect/all/start            # every 6 h: each shipped Variants sample's channel numbers (post metrics, site events, email template stats) into `variants.outcomes` per segment; /sync now (`wren variants collect`)
```

### Runtime state

The door speaks Restate's ingress protocol: `/Service/key/handler`, `/send`, the `inv_` ids.
Read state from Postgres:

```sh
node scripts/prod-sql.mjs "SELECT service, status, count(*) FROM rt.invocations WHERE status <> 'done' GROUP BY 1, 2"
node scripts/prod-sql.mjs "SELECT seq, kind, name FROM rt.journal WHERE invocation_id = '<inv_id>' ORDER BY seq"   # one call's journal
node scripts/prod-sql.mjs "SELECT build, started_at FROM rt.box_builds ORDER BY started_at DESC LIMIT 3"   # which slot takes new rows
node scripts/prod-sql.mjs "SELECT service, handler FROM rt.handlers ORDER BY 1, 2"         # what each build serves
```

The admin views (`rt_admin`) keep Restate's `sys_invocation` and `state` shapes, so `wren dlq`,
`wren loops` and the portal's Console read them unchanged.

### Dead letters

A call whose retries ran out is paused: its object stays locked and nothing moves until
someone acts. Retries: a handler's `retryPolicy`, else `SERVER_RETRY` in `packages/runtime/src/pg/store.ts`
(500 ms, x2, 1 min max, 70 tries, about 1 h). Webhook services keep an idempotency key 7 days (`WEBHOOK_SERVICE`). The `DeadLetterFile/all` loop files each one every 10 minutes and tells Discord
once (designs/2026-10-11-dead-letters.md).

```sh
wren dlq list [--all] [--json]   # open letters, oldest first
wren dlq show <id>               # the error and the journal, step by step
wren dlq retry <id>              # resume where it stopped, on the newest deployment
wren dlq kill <id>               # give up; its caller sees the error
wren dlq drop <id>               # handled some other way; the runtime row left alone
wren dlq sweep start|status|sync # the loop
```

### Loop health

A loop is dead when its chain ended (running, no next call) and stuck when its pass waits on
a call that won't answer. `LoopRevive/all` checks every loop every 10 minutes, wakes a dead one
and names a stuck one with its blocker, once per incident. It never ends a blocker: that's
`wren dlq` (designs/2026-10-16-loop-watchdog.md). The hourly CI job `runtime-lag-check.yml` alarms on late rows, dead
leases and a LoopRevive with no next check.

Every call a pass waits on has a time limit, so stuck should be rare now. A call past its limit
is cancelled (a write is left running) and its unit skipped; `wren loops` prints it under the
loop. A unit that times out 3 passes in a row is held in Checks (stage `loop.<service>/<key>`;
release it there). A pass that throws is kept as a failed pass and the chain goes on.

```sh
wren loops [--all] [--json]          # every loop: alive, dead, stuck (stopped with --all)
wren loops watch start|status|sync   # the watchdog loop
wren loops cancel <inv_id>           # cancel a running call
```

### Feature flags

The portal's Flags page is gone; the CLI is the only writer. Edits keep History and Undo, and a
site flag pushes to the lander's edge (`WREN_SITE_EDGE_TOKEN`).

```sh
wren features [--json]                      # every flag, its rules and fallback
wren features kill|live <key>               # the kill switch: everyone gets the fallback
wren features set <key> --rules "on: clients <id>"   # rules one per line, first match wins
wren features add <key> [--surface site] | rm <keys...>
```

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

Pooling: PgBouncer (`wren-pgbouncer`, transaction mode) listens on 6432 and owns at most 40 of
Postgres's 60 connections; the rest are for the CLI, migrations and backups on 5432. CI runs
`deploy/scripts/box-pgbouncer.sh` each deploy (unchanged config is left running). The worker
uses it through `WREN_DATABASE_POOL_PORT=6432`, set in `deploy/terraform/lambda.tf` and
`deploy/scripts/box-worker.sh` (not `prod.env`, so the CLI never sees it); remove both to go
straight to Postgres. Logins: main's from the container, every other role's SCRAM secret by `auth_query`.
`docker logs wren-pgbouncer` shows each refused login and pool limit.

No cache: reads go to Postgres. Redis is gone (2026-11-09); the table `rt.cache` exists, unused.

Migrations from a laptop (URL never echoed):

```sh
WREN_DATABASE_URL="$(cd deploy/terraform && tofu output -raw database_url)" pnpm db:migrate
```

### Deploying a change

Push to `main` → `ci` green → `deploy.yml` (`deploy/scripts/deploy.sh`): migrations against
prod, the box worker's new slot, a new Lambda version, then the Cloudflare Workers. The new slot
writes its build to `rt.box_builds` and takes every new row; the old slot (`wren-worker-old`)
finishes the rows pinned to its build. Lambda rows pin to the version they started on. A slot
that sees a newer build stands down within 10 s. A failed new build hands back: restart the live
slot and it writes itself as newest again.

GitHub environment `production` secrets: `AWS_DEPLOY_ROLE_ARN`,
`LAMBDA_NAME`, `WREN_DATABASE_URL`, `WREN_API_HOST` (the door's host, an old name),
`WREN_API_TOKEN`. Mirror: `deploy/github-secrets.env`.

### Changing env vars

Edit `deploy/prod.env`, run `deploy/scripts/push-secrets.sh`, then
`gh workflow run deploy.yml --ref main`: it publishes a new Lambda version and starts a new box
slot, so every instance cold-starts and re-reads SSM. (Bumping `$LATEST`'s description does not
recycle a published version's instances; the Lambda lane invokes `:N`, not `$LATEST`.) The box
keeps its slot only when the bundle, `box-worker.sh` and the SSM env versions all match, so a
rerun after an env change starts a new slot.

`/wren/prod/env` and `env-2` are full; new names go in `env-3`. It holds the Plaid keys
(`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_SANDBOX_SECRET`) and each linked card's token
(`PLAID_ACCESS_TOKEN_<last4>`, from `wren books card finish --keep-to`). Add a name: merge it into
the parameter's JSON object and put the whole object back; never push-secrets over it.

## The campaign, end to end

Nothing is by hand once a niche has leads. `EmailOpenerFill/{niche}` runs once a day
(local midnight): capacity = active inboxes × today's per-inbox cap; it keeps
`WREN_COMPOSE_DAYS_AHEAD` (3) days of approved openers queued, composing the shortfall
through the niche's enrollment plan (`packages/niches/src/<niche>.ts` `plan`: agencies
route by `agency_facts.segment`, marketing → `marketing-days-0-5`, build →
`build-days-0-5`, unsegmented → marketing). Every draft is auto-approved and pins the
sign-off with the niche's page (`/agencies`, `/ria`), so the copy and the site agree.
`EmailSend/{inbox}` sends them inside the window at the ramp; `EmailInboxRead`
reads replies and bounces; kill switches pause a domain at 2% bounces. `status` on the
compose object shows the last pass: `queued`, `target`, `enrolled`, `exhausted` (pool
empty: import more leads or verify more addresses).

## Feeding the pool

`exhausted: true` on the compose object means every company with a sendable
address is enrolled. Growth is the research chain. `LeadPoolFill/{niche}` walks
it: one bounded call per stage per pass, another pass a minute later while any
stage still finds work, then sleep until the next local day. What may call the
model is `WREN_POOL_MODEL_STAGES`: `none` (default — discover, crawl, render, scan
only; no verdicts, so no new leads yet), `pick` (one model call per company with
more than one address; this is what turns role inboxes into leads), `all`
(extraction too, one call per stored page — the expensive one).
`WREN_POOL_PROFILES=true` adds `profiles`: LinkedIn pages of the people compose
reaches in the next week, read from Exa's cache through autobrowse `web` (metered;
Google at most 200/day, 8–20 local), then recomputes the firm's lead checks.
`WREN_POOL_LINKEDIN=<address>` adds the logged-in LinkedIn step on that research alt
(never William's own account; autobrowse caps it per day). Its cap skips the step until
it lifts; the stage keeps going. `wren enrich profiles --niche <n>` runs it by hand; `wren enrich checks --niche <n>` recomputes the checks alone (free, no calls).
`signals` runs last on Wren's niches once a collector is built (free sources; each collector
on or off in the `research.signals` component). `wren enrich signals --niche <n> --dry` previews it.

```sh
curl -X POST -H "$H" $U/LeadPoolFill/sec_ria/start    # /status shows per-stage progress and errors
curl -X POST -H "$H" $U/LeadPoolFill/agencies/start
# Only some stages for a niche (applies from the next pass; kept until changed):
curl -X POST -H "$H" -H 'content-type: application/json' $U/LeadPoolFill/sec_ria/start \
  -d '{"stages":["resolveMailboxes","verifyMailboxes"]}'
# ...and back to every enabled stage: -d '{}' 
```

`stop` is an exclusive handler: it runs after the pass in flight, so on a long pool
pass the request waits. To interrupt now, `wren loops cancel <the loop's inv_ id>` (the
calls it waits on stop with it), then `stop`, then `start` when ready.

A discovery or verification miss is written to `discovery_attempts` (outcome:
`no_candidate`, `unreachable`, `gate_rejected`, `no_name`) and keeps that company out of
the queue for 30 days, so a head of unguessable names never blocks the rest.

The stages by hand, keyed by niche (`all` = every niche); each reports what it moved:

```sh
curl -X POST -H "$H" -H 'content-type: application/json' $U/Discovery/sec_ria/discover -d '{"limit":10}'   # name → domain, DoH + homepage gate, free; one unit per company
curl -X POST -H "$H" -H 'content-type: application/json' $U/Discovery/sec_ria/verify   -d '{"limit":10}'   # prove asserted domains, free
curl -X POST -H "$H" $U/Enrichment/sec_ria/crawl   -d '{"limit":10}'   # homepage + contact/team pages
curl -X POST -H "$H" $U/Enrichment/sec_ria/render  -d '{"limit":10}'   # JS shells, through the render Lambda
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
A `risky` verdict (greylist, tarpit) is tried again after its wait: a greylist
1 hour, then 1 day, then 7 days; any other reason its own wait (blocked 7 days,
else two days), doubled each time, up to 30 days. After 4 risky verdicts in a row
(no valid or invalid between) the address rests 90 days and stays risky. Counted
per address, leads and candidates alike (`verification/retry.ts`).

The handshake itself is not wren's: it lives in **mailifier**
(github.com/WilliamJin123/mailifier, `npm i mailifier`), and wren plugs it into
the `EmailVerifier` port in one file, `verification/mailifier.ts`. Port 25 is
closed from Lambda and AWS refused to open it on EC2, so the prober
is that package's own server on a RackNerd VPS (192.255.226.241, Ubuntu 24.04,
$21.99/yr, key-only SSH as root with `~/.ssh/wren_probe`, also in SSM
`/wren/prod/probe_ssh_key`). Docker compose runs it behind Caddy, which holds the
TLS for `https://probe.wrenautomation.com` (`deploy/vps/`). The worker reaches it
through `WREN_VERIFIER=smtp` + `WREN_SMTP_PROBE_URL` + `WREN_SMTP_PROBE_TOKEN`
(`deploy/prod.env`; the same token is SSM `/wren/prod/probe_token`).

```sh
deploy/scripts/deploy-vps.sh                      # pinned mailifier + SearXNG + compose + Caddy → VPS, restart
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
`PROBE_HOST=probe2.wrenautomation.com deploy/scripts/deploy-vps.sh`. Only boxes
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
`resolveMailboxes` walks only the person guesses someone queued (`LeadVerify/default/queue`).

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
wren email import maps.csv --format google-maps --niche <niche>               # the current Maps scraper's CSV
wren email import-people ADV_Filing_Data_20260701_20260731.zip --format adv-filing-data   # owners, officers, CCOs
wren email import-people linkedin-ria-founder.csv --format linkedin --niche <niche>  # autobrowse `people --enrich`
```

Directory hosts (clutch.co, shopify.com, …) are platform domains in every import: a
listing URL is kept as the company's social URL, never as its domain; a firm with no
real domain keys by `clutch:<slug>` / `crd:<n>` and gets a domain later from discovery.

Local businesses come from Google Maps through the current Maps scraper (MIT,
[repo](https://github.com/gosom/google-maps-scraper)), run by hand
or by `autobrowse maps "<search>"` (starts it, writes the CSV, stops it)
(port 8090: the dev worker's door owns 8080). Keep `-c` at 2 to 4 without proxies; empty results
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


## Search (SearXNG on the VPS)

The research engine's free web search is a SearXNG on box 1 (`deploy/vps/`, profile
`search`, image pinned by date, 350 MB cap, no Redis). Caddy serves it as
`https://search.wrenautomation.com` and answers 401 without the bearer (SSM
`/wren/prod/searxng_token`); `/healthz` is open. SearXNG's own cookie key is SSM
`/wren/prod/searxng_secret`. The A record is Cloudflare, DNS only. On the Mac the model keys
file at the org root holds `SEARXNG_URL` and `SEARXNG_TOKEN`; weaver's `searxng` source sends
the bearer when the token is set. Box 2 runs the prober alone (`SEARCH_HOST=` empty).

Pace: nginx (`pacer`, `deploy/vps/search.nginx`) sits between Caddy and SearXNG. One bucket
for every caller: 12 searches a minute, a burst of 12 waits in line, past that 429. SearXNG
pauses an engine after a block (`suspended_times` in `searxng.yml`: 15 min rate limit, 2 h
CAPTCHA). From this IP (2026-11-02) Bing, Yahoo, PrivacyWall and Mwmbl answer; Brave,
DuckDuckGo and Qwant block; Google, Mojeek and Startpage stay off. Google comes from the
desk's browser (weaver `google`), Reddit from the desk's `reddit-public`.

```sh
deploy/scripts/deploy-vps.sh                                      # box 1: prober + search
PROBE_HOST=probe2.wrenautomation.com deploy/scripts/deploy-vps.sh  # box 2: prober alone
curl -s https://search.wrenautomation.com/healthz                 # OK
node scripts/secrets.mjs run ../llm.env -- \
  'curl -s -H "Authorization: Bearer $SEARXNG_TOKEN" "https://search.wrenautomation.com/search?q=test&format=json"'
```

## Checking the fleet

```sh
wren email senders list                 # roster + pauses
wren email senders check [--niche x]    # mints each inbox's delegation token; exit 1 on any failure
wren email senders check --send         # plus one test mail per inbox to the next inbox in the fleet (nothing leaves the fleet)
wren email deliverability               # per domain: DNS + lists, seed auth (SPF/DKIM/DMARC), plain and real placement, verdict, pause
wren email spamcheck [--drafts N]       # SpamAssassin (Docker) on every live template option and the newest openers; fails at 2.0
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
`deploy/pixel/`. Tracking is off (`WREN_OPEN_TRACKING`), and nothing pulls hits: the opens loop
was deleted 11-04 (designs/2026-11-04-loops.md).

## Email link clicks

Each email's sign-off link carries `?r=<code>`; the lander records it on the landing view.
`EmailClickPull/fleet` reads those views hourly into `email_clicks` whenever
`WREN_SITE_EXPORT_TOKEN` is set, and `wren email clicks` lists them, with what each clicker did
on the site afterwards read live from the export (never stored). The loop is started by
hand like the others (the first pass reads the lander's whole history). Text and DM `/go/`
links carry no code, so their clicks are not counted.

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
| ads | `WREN_DISCORD_ADS_WEBHOOK_URL` | AdSpendGuard |
| content | `WREN_DISCORD_CONTENT_WEBHOOK_URL` | content scheduler, metrics, planner |
| clients | `WREN_DISCORD_CLIENTS_WEBHOOK_URL` | ClientUpdateMail, reactivation |

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

`WREN_NOTIFY=none` (the default) binds no `EmailFleetDigest` and every loop stays silent.

## Things to watch

- **Postgres is on the public internet** (TLS-only, scram, 32-byte password)
  because Lambda has no fixed IP and a NAT gateway costs more than the box.
  Rotate: change `pg_password` in `terraform.tfvars`, `tofu apply`, update
  `WREN_DATABASE_URL` in `prod.env`, `push-secrets.sh`, new cold start.
- **Backups are dumps, not point-in-time.** 08:00 UTC daily. A bad write at
  14:00 loses up to a day of ledger.
- **Lambda invoker.** The box's instance role invokes the Lambda (the Lambda lane). The Cloud
  invoker role `wren-prod-restate-invoker` and its Terraform are gone (2026-11-09).
- **AWS account.** IAM user + MFA done. Budgets (console only, not Terraform): `Monthly cost 15 USD`
  mails at 100% actual and forecast; `My Monthly Cost Budget` ($30) at 85% and 100%. Use the IAM user for the CLI
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
| Runtime | `packages/runtime/src/pg/` (door, dispatcher, turn, store) |
| Loop primitive | `packages/core/src/restate/loop.ts`; send loop `packages/starling/outbound/src/email/restate/send-scheduler.ts` |
| Secrets (gitignored, chmod 600) | `deploy/prod.env`, `deploy/github-secrets.env`, `deploy/terraform/terraform.tfvars`, `.env` |
| CI | `.github/workflows/deploy.yml`, GitHub environment `production` |

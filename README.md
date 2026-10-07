# wren

Wren Automation platform. One TypeScript monorepo: durable automations on Restate, Postgres via Drizzle, dashboard in Next.js (later). Spec: `designs/2026-09-17-platform-spec.md`.

New here: `walkthrough/` is the guided path (setup → content loop → Meta ads →
email campaign → production) with read-only demos against prod.

## Quick start

```bash
cp .env.example .env
pnpm install
docker compose up -d          # Postgres :5434, Restate ingress :8080 admin :9070
pnpm db:migrate
pnpm worker                   # Restate endpoint on :9080 (keep running)
pnpm register                 # tell Restate where the worker is (once per worker restart)
ln -s "$PWD/bin/wren" ~/.local/bin/wren   # the CLI, compiled on first run and after every source change
wren status
```

## Content loop (every platform)

```bash
wren status                         # drafts, open ideas, spend; exit 1 on Thursday+ with nothing drafted this week
echo "shipped the spend gate today. every buy asks me first." | wren content add
wren content add idea.md --media short.mp4 --title "Spend gate"   # a short: YouTube, Reels, TikTok, X, LinkedIn captions
wren content drafts                 # one row per platform, status draft
wren content show <draftId>
wren content redraft <draftId> "shorter, keep the discord line"   # the model rewrites from your note
wren content edit <draftId> fixed.md
wren content approve <draftId>...   # each posts at its platform's next slot (LinkedIn 08:30 + 12:30 weekdays, X noon, IG 18:00 … on WREN_SEND_TIMEZONE)
wren content approve <draftId> --at 2026-09-23T14:00:00Z
wren content approve <draftId> --now  # on the queue's next pass
wren content queue start            # ContentScheduler/default: posts approved drafts as they come due
wren content metrics start          # ContentMetrics/default: one look per young post per day; Monday = what-worked to the channel
wren content planner start --draft  # ContentPlanner/default, 17:00: drafts tomorrow's open slots (ideas, build log, a reader's question); approve keeps the slot
wren content results --days 7       # published posts, engagement per 100 views, best first
wren content costs --days 30        # drafting calls and tokens by platform and model
```

Drafts follow `WREN_CONTENT_VOICE` (a markdown file in your words), your last redraft notes
on that platform and its best posts so far, and go out through the channels in
`WREN_CONTENT_CHANNELS`. A local `--media` file lands in `WREN_MEDIA_BUCKET`
first (the worker and the box cannot read this laptop); a URL is used as is. Design: `designs/2026-09-22-content-loop.md`.

## Meta ads

```bash
wren ads accounts                    # the ad accounts the Meta token admins
wren ads interests "shopify"         # interest ids for the spec's targeting
wren ads launch ads/founders.json    # campaign → ad set → creative → ad, all PAUSED; prints the ids
wren ads start <campaignId> <adsetId> <adId> --daily 20   # the one command that spends
wren ads insights --preset last_7d   # spend, impressions, reach, clicks, ctr, cpc per campaign
wren ads stop <campaignId>
wren ads lead-form founders https://wrenautomation.com/privacy   # an instant form; id → creative.leadForm
wren ads leads <formId>              # what the form collected (needs leads_retrieval from app review)
wren ads launches                    # the ad_launches ledger: ids, budget, started/stopped, why
wren ads watch start                 # AdsWatch: daily guard, pauses a launch that spent $50 with nothing to show
wren ads spec-from <draftId> --out ads/post.json   # a post that worked → a PAUSED launch spec (same words, same media)
```

The spec file: `name`, `objective` (OUTCOME_LEADS, OUTCOME_TRAFFIC, …), `dailyBudgetUsd`,
`targeting {countries, ageMin, ageMax, interests[{id,name}]}`, `creative {message, link,
headline, description, callToAction, media {kind, source}, leadForm {id} | {name, privacyUrl,
questions?, followUpUrl?}}`. With `leadForm` (OUTCOME_LEADS, `optimizationGoal:
LEAD_GENERATION`) the CTA opens the instant form on Facebook instead of the link, and
`wren ads leads <formId>` reads the answers. A local media file lands in
`WREN_MEDIA_BUCKET` first. Every ACTIVE write is a spend on the box: it asks (or auto-yes
under its small cap) and writes the ledger. `WREN_META_AD_ACCOUNT_ID` picks the account;
unset = the first one. Every launch/start/stop lands in `ad_launches`; `AdsWatch/default`
reads adset insights once a day and stops any active launch whose 7-day spend reached
`WREN_ADS_PAUSE_AFTER_USD` (default 50) with zero clicks and zero results — it only ever
stops spend, and each pass is one message to the channel. A launch that wins (a result,
or ten clicks) becomes one open idea for the content loop (`wren content ideas`, source
`ads`), once; nothing is drafted until you say. The other way: `wren ads spec-from
<draftId>` turns a published post into a spec. Design:
`designs/2026-09-22-meta-ads.md`.

## SMS

`wren sms` runs Wren's texts; `wren --client <id> sms ...` runs a client's, on its
database, once `sms.texts` is installed. Steps: `walkthrough/05-sms.md`. Design:
`designs/2026-09-27-phone-channel.md`, `designs/2026-10-04-outbound-per-client.md`.

## Webhooks (the door)

`wren [--client <id>] hooks add <workflow> <input> --subject <field> [--name ...]` prints a
`https://phone.wrenautomation.com/hooks/<token>` URL once. Anything that POSTs JSON or a form to
it enters that workflow's input, about the payload's `<field>`. `wren hooks list` shows each
hook's calls. Design: `designs/2026-10-05-workflows.md` (The spine).
`wren hooks preset site` makes the lander's hook into Wren's speed to lead and says where the URL
goes (the lander's `WREN_DOOR_URL` Pages secret).

## Workflow templates

`wren --client <id> workflows templates|plan|install|publish|uninstall <template>` puts a whole
workflow on a client: parts, copy, a draft and a shut door. Nothing starts until a person approves
it in To approve; the CLI never approves. `wren [--client <id>] workflows save-template <workflow>
--name "..."` keeps a published workflow's live wiring as a template (the editor's History menu
does the same). Design: `designs/2026-10-07-template-install.md`.

## The Watch

`wren watch start|stop|status|sync`: `Watch/all` on the box reads new mail in William's inboxes
every 15 minutes (`WREN_WATCH_MAILBOXES`, else the books' own), skipping promotions and social.
Each email goes along the `watch` workflow to triage: a rule with a sender and a verdict settles it
for $0, the model in `WREN_WATCH_LLM` (Cohere, set in `lambda.tf`) reads the rest. What needs him
shows in the Inbox app under Your mail; Hide like this writes a rule, Sort again (or `wren watch sort`)
re-triages what's waiting under today's rules. No bodies are kept. The same pass reads each feed Wren
follows (hourly) and scores new items 0-10 against the pushed SOPs: 7 and up shows under Worth
reading, 4 to 6 holds. Follow a feed from Inbox → Feeds.

## Social inbox

`wren social start|stop|status|sync`: `SocialWatch/wren` on the box, every 30 minutes 07:00-23:00
New York. It reads comments on our posts of the last 14 days (older than 3 days every 2 hours),
activity since the newest kept row (LinkedIn every 2 hours), and the follower count once a day.
LinkedIn's count only on demand: `wren social audience linkedin` or Followers → Read now.
New comments go on the `reach.comments` spine. One Discord ping per pass that kept something; a text
only when a comment asks. Work them in Marketing → Inbox; answers go out only on William's click.

## Drafts

Every draft waiting on William, by its Inbox id (`draft:<id>` a post, `comment:3`, `thread:t3_x`).
Nothing sends; each write is a `runs` row the item's thread shows. In the console, Ask Claude on a
draft has Claude Code on William's Mac rewrite it ($0), and Undo puts the old text back.

```bash
wren drafts list [--type post|comment|thread] [--limit 50]   # newest first
wren drafts show comment:3          # the whole draft, what it answers, its Ask Claude thread
wren drafts set comment:3 --file answer.md   # or pipe it in; the same field the console edits
wren drafts edits --type dm --limit 5        # how William changed drafts, before and after
node scripts/prod-wren.mjs drafts list       # on prod
```

## Chores through autobrowse

`restateDo(ctx, wake)({ goal: "upload this to youtube", inputs: { file } })` from a
handler, `autobrowseDo({ url, token })` from a laptop: one verb, autobrowse routes
it (site API → compiled workflow → its agent, which compiles what it did for next
time). `restateSites(ctx)` stays for calls that need the official API shape.

## SOPs

`wren sop add <name> <youtube url | drive:<folderId> --account <addr> | file> [--priority n] [--no-screen]`
ingests a source into `../sops/<name>/sources/` (a private folder, its own git). A video is
its captions plus an `## On screen` section: Gemini (llm.env keys) reads the URL in clips and
transcribes the documents and slides shown; `--no-screen` skips that.
`wren sop build <name>` writes the next `SOP.md` from `notes.md` (your rules, top
priority) and the sources on Claude Code. Iterate: edit notes.md or SOP.md, build again.
`wren sop extract <name> [source]` lists every point a source makes into `points/<source>.md`
(cited); delete lines you don't want, prefix `!` on ones that must appear, and build reads the
points instead of the raw source.
`sop build` also writes `SKILL.md`; `wren sop link <name>` symlinks the folder into `~/.claude/skills/sop-<name>`
so Claude Code can follow the SOP as a skill. A non-text source (PDF, image) lands in `refs/`.

## Gates

`./scripts/gates.sh` runs lint + typecheck, unit tests, integration tests (Docker). CI runs the same.

## Map

`map/` is a system map for agents: what each table, type and loop is, why, and what a change hits. Start at `map/CLAUDE.md`; cards cite `path:line`. Generated files rebuild with `map/_meta/build.sh` (checked by `gates.sh lint`).

## Layout

See spec §3. Rules: deps point down; channels never import each other; every package owns `src/schema.ts` and `packages/db/drizzle.config.ts` lists them; Restate handlers in `src/restate/`, pure step functions beside them.

## Schema changes

Edit a package's `src/schema.ts`, then `pnpm db:generate` (writes `packages/db/drizzle/NNNN_*.sql`; review it), then `pnpm db:migrate`. Never edit a committed migration.

## Legacy data

`scripts/import-legacy.sh [db]` copies every row from the emails_gen Postgres into a migrated wren database. Run once, into an empty target. See `designs/2026-09-17-channel-email-port-plan.md`.

## Deploy

Restate (self-hosted on the EC2 box) → Lambda → Postgres on the same box. `deploy/README.md` is the runbook; `deploy/terraform` the infrastructure; CI ships `main` after `ci` is green.

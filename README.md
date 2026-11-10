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
wren content queue start            # PostPublish/default: posts approved drafts as they come due
wren content metrics start          # PostMetrics/default: one look per young post per day; Monday = what-worked to the channel
wren content planner start --draft  # PostPlan/default, 17:00: drafts tomorrow's open slots (ideas, build log, a reader's question); approve keeps the slot
wren content planner slots linkedin 08:30 --days 1-5  # one platform's post times (1 = Monday); keeps the rest, starts the planner
wren content results --days 7       # published posts, engagement per 100 views, best first
wren content costs --days 30        # drafting calls and tokens by platform and model
```

Drafts follow `WREN_CONTENT_VOICE` (a markdown file in your words), your last redraft notes
on that platform and its best posts so far, and go out through the channels in
`WREN_CONTENT_CHANNELS`. A local `--media` file lands in `WREN_MEDIA_BUCKET`
first (the worker and the box cannot read this laptop); a URL is used as is. Design: `designs/2026-09-22-content-loop.md`.

Video footers are templates: `post:youtube/footer` under a long video's description,
`post:youtube/shorts-footer` under a Short's, `post:instagram/reel-footer` under a Reel's caption.
Edit with `wren templates get post:youtube/footer > f.post`, then `wren templates set
post:youtube/footer f.post --why "..." --expect <n> --publish`, or in Library, Templates. A new
version waits in To approve. Wren ships no footer words: with none live, a video goes out with no footer.

## Meta ads

Cut 2026-11-04 (stripdown): `wren ads`, `Ads` and `AdSpendGuard` are gone. The `ad_launches` and
`ad_days` tables stay. Code: git tag `pre-cut-2026-11-04`.

## SMS

`wren sms` runs Wren's texts; `wren --client <id> sms ...` runs a client's, on its
database, once `sms.texts` is installed. Steps: `walkthrough/05-sms.md`. Design:
`designs/2026-09-27-phone-channel.md`, `designs/2026-10-04-outbound-per-client.md`.

## Webhooks (the door)

`wren [--client <id>] hooks add <workflow> <input> --subject <field> [--name ...]` prints a
`https://phone.wrenautomation.com/hooks/<token>` URL once. Anything that POSTs JSON or a form to
it enters that workflow's input, about the payload's `<field>`. `wren hooks list` shows each
hook's calls. Design: `designs/2026-10-05-workflows.md` (The executor).

## Workflow templates

`wren --client <id> workflows templates|plan|install|publish|uninstall <template>` puts a whole
workflow on a client: parts, copy, a draft and a shut door. Nothing starts until a person approves
it in To approve; the CLI never approves. `wren [--client <id>] workflows save-template <workflow>
--name "..."` keeps a published workflow's live wiring as a template (the editor's History menu
does the same); `wren workflows delete-template <id|name>` takes one off, refused while a client
runs it live. Design: `designs/2026-10-07-template-install.md`.

## The Monitor

`wren monitor start|stop|status|sync`: `MyMailTriage/all` on the box reads new mail in William's inboxes
every 15 minutes (`WREN_WATCH_MAILBOXES`, else the books' own), skipping promotions and social.
Each email goes along the `watch` workflow to triage: a rule with a sender and a verdict settles it
for $0, the model in `WREN_WATCH_LLM` (Cohere, set in `lambda.tf`) reads the rest. What needs him
shows under Today → Mail; Hide like this writes a rule, Sort again (or `wren monitor sort`)
re-triages what's waiting under today's rules. No bodies are kept. A client's Google data (a Gmail
mailbox, YouTube comments, Business Profile reviews) reaches only `WREN_GOOGLE_LLM`, a model that
doesn't train on it; unset, none.

## Social inbox

`wren social start|stop|status|sync`: `SocialActivityRead/wren` on the box, every 30 minutes 07:00-23:00
New York. It reads comments on our posts of the last 14 days (older than 3 days every 2 hours),
activity since the newest kept row (LinkedIn every 2 hours), and the follower count once a day.
LinkedIn's count only on demand: `wren social audience linkedin` or Followers → Read now.
New comments go on the `reach.comments` executor. One Discord ping per pass that kept something; a text
only when a comment asks. Work them in Today → Messages; answers go out only on William's click.

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

## Judge

Machine calls beside William's (designs/2026-10-16-decide.md, 2026-11-04-loops.md). The judge
agent (Claude Code on the desk, his plan, $0) judges drafted comments (send, edit, drop) and lead
fits, each with a one-line why and its session id; Learn items stay on `WREN_DECIDE`'s chain.
His send, drop, star or archive is logged next to it. `NextStepDecide/wren` runs every 10 minutes; while
the Mac is off, its kinds wait. The Agents page shows the same numbers.

```bash
wren judge stats                   # per kind: mode, his calls, agreement, overrides, tokens, $
wren judge mode document shadow    # off, shadow, recommend (a chip), gate (refused until built)
wren judge export --called --out decisions.jsonl   # wren.decision/1: the distill set
wren judge backfill [--dry-run] [--sample 100 --max-usd 2]   # history's calls; a judged sample
wren judge pass                    # one pass here
```

## Accounts

Every account we post and reply as, the same rows as Back office → Accounts. A draft on a platform
with two or more accounts has a Send as picker; the pick is kept with the draft and the send uses
it. A pick that misses a sub's karma or age rule gets a warning and still sends.

```bash
wren accounts [--platform reddit]       # key, site, state, health, sent today, places
wren accounts show reddit@alt           # one in full, with its last 10 sends
wren accounts assign smallbusiness reddit@alt   # move a subreddit to another account
wren accounts pick thread:t3_x reddit@alt       # send this draft as it; `default` clears
wren reach reply 12 --body "..." --account reddit@alt
```

## Chores through autobrowse

`restateDo(ctx, wake)({ goal: "upload this to youtube", inputs: { file } })` from a
handler, `autobrowseDo({ url, token })` from a laptop: one verb, autobrowse routes
it (site API → compiled workflow → its agent, which compiles what it did for next
time). `restateSites(ctx)` stays for calls that need the official API shape.

## Call recordings

The desk on William's Mac records each booked call with OBS. It starts 5 minutes before the call if a Meet or Zoom window is open. It stops 3 minutes after the window closes. Record now and Stop recording sit on Today → Calls (`/today/calls`). The desk asks `wren calls upcoming` what to wait for, and runs `wren calls add <file>` on each finished file. That command encodes a 720p mp4 and transcribes it on the Mac. It writes the notes, uploads the video and puts a line on the person's timeline. Today → Recordings (`/today/recordings`) lists every recording. Setup and the desk side live in autobrowse (`autobrowse calls setup`); the design is `designs/2026-10-16-call-recording.md`.

## Groups and channels

A group's rule reads as text, so agents write it the way the portal stores it:
`all(trait persona is "agency owner", step saw on reddit in 30d, not message opened on email ever)`.
`wren groups check|count <rule>` reads one and counts it; `save <name> --rule <rule>` makes or
changes one (each save is a version, `history <group>` lists them); `list`, `show`, `members`,
and `in <group> <id|email>` (exits 1 when not). A rule can be inline, `@file` or `-` for stdin.
`wren channels` prints each channel's funnel, reached to paid (`--by source|trait:<key>`,
`--channel`, `--days`, `--group`, `--rule`, `--attribution any|first|last`,
`--people <key>:<step>` for the people behind one number, `--json`).

## Offers, terms, shape

`wren offers sync` adds a version for each registry offer whose shape changed (main only; run by hand, the deploy no longer does). `offers list` and `offers versions <offer>` read them.
`wren terms add <offer> --plan <p> --from <date> --file <json> [--why]` adds the next version of a plan. `terms show <offer> [--plan] [--at <date>]` reads them. Amounts come from the file, never from code.
`wren shape` is the business map: sources, steps, offers and plans, joined by flow and loop edges. One shape per database; each change is a new version with a reason.
`shape show [--version n]` prints the outline with the journeys open on each node. `versions` lists them. `diff <a> <b>` says what changed. `export [--version n] [--out file]` writes a shape file. `import <file> [--note]` saves a file as the next version, with the terms it lists.
`shape add-node <id> --kind source|step|offer|plan --name <text> --note <why>` adds a node (`--from <node>` and `--to <node>` add its flow edges; `--via`, `--action`, `--offer`, `--terms`, `--advance trigger.id:key=value`, `--research`, `--idle-days` set the rest). `connect <from> <to> --note <why> [--loop] [--label]` adds an edge. `remove <id> --note <why> [--edge]` drops a node with its edges, or one edge. It refuses while journeys are open on the node, unless `--move-to <node>` sends them on or `--ghost` leaves them on their own version.
`shape move <journey> <node> [--reason]` and `journeys move` are one command: it goes through the worker's `JourneyMove` service along the shape's edges, or forced with `--reason`.
`shape start` saves the starter (kind-only nodes, no real names or amounts) as v1 with the note Starter. It does nothing when a shape exists.
`journeys open|move|drop|rebuild|show|list`, `deals list|sign|schedule` and `numbers [--source <id>] [--offer <id>] [--window 7|30|90|all]` read and write journeys and deals. `terms`, `shape`, `journeys`, `deals` and `numbers` take `--client`.

## SOPs

`wren sop add <name> <youtube url | drive:<folderId> --account <addr> | file> [--priority n] [--no-screen]`
ingests a source into Canon (`../canon`, private, `@wrenautomation/knowledge`): a source
record tagged with the SOP's name, one commit with a by and a why. A video is
its captions plus an `## On screen` section: Gemini (llm.env keys) reads the URL in clips and
transcribes the documents and slides shown; `--no-screen` skips that.
`wren sop sync <name>` writes `standard.md` (the numbers off `learn.standards` for the pieces the
front matter of `notes.md` names: `kinds`, `platforms`, `topic`, `set`) and `calls.md` (your keep /
tune / drop calls on those pieces, rolled up and cited `[learn:<id>]`).
`wren sop build <name>` syncs, then writes the next guide (`guides/<name>.md`, the procedure) and its rule sets
(`rules/<name>/<set>.md`, one rule per line with a fixed id) from `notes.md` (your rules, top priority), your
calls, the standard and the sources on Claude Code (`--no-sync` skips the sync). A build never drops a set.
Iterate: edit notes.md, call on pieces (`wren learn call`), build again.
`wren sop extract <name> [source]` lists every point a source makes as finding records tagged with
the SOP (cited, generated only); build reads the points instead of the raw source.
`notes.md`, `calls.md`, `standard.md`, `refs/` and `SKILL.md` sit in `topics/<name>/`. `knowledge render <name>`
prints the SOP with its Sources list. `wren sop link <name>` symlinks the topic into `~/.claude/skills/sop-<name>`
so Claude Code can follow the SOP as a skill. A non-text source (PDF, image) lands in `refs/`.

## Claude setups in a page

`wren agent serve` runs the relay on `ws://127.0.0.1:4748`. Each session opens one unmodified `claude` on this
Mac's Claude plan. A portal page drives it with `modules/agent/connect.ts` (designs/2026-11-04-multi-user-runtime.md).
A setup (`packages/agent/src/setups.ts`) is one record: app, tools, skill plugin, allow rules, model.
Setups: `research` (Weaver), `vireo` (Vireo, plugin in `packages/variants`) and `orrery` (Orrery, the Map's chat:
plugin and `shape` bin in `packages/pipeline`, reads and draft writes only). A plugin is a package name or a path
from the workspace root (the parent of `$WREN_ROOT`, else of the cwd); its `package.json` `bin` lands on the child's
PATH. The side chat opens the setup whose title is the page's product. The relay's launchd job
(`com.wrenautomation.agent-serve`) runs the bundle without `bin/wren`, so it sets `WREN_ROOT` itself: without it
path plugins, setup folders and the Wrenfile resolve from the wrong folder.
This Mac's own setups (makers: a wide shell in one project) are `tasks/docs/agent/setups/<name>.json`, with
`<name>.md` as the system prompt text. They open for the Mac's owner only; a setup may carry the CLI's `sandbox`
settings (`packages/agent/src/host.ts`, designs/2026-11-05-variants.md).
A setup with `runs` (Vireo) starts headless runs of a maker: `maker list|start|status|stop` in its chat,
`wren agent makers|run|runs|stop` in a terminal. A run is one prompt with no page; the relay queues it, denies
every ask and keeps its state, result and session (`packages/agent/src/runs.ts`). `--run-min` caps a run.
`wren agent setups` lists them. `wren agent token` prints the token a page sends first.
`wren agent check [setup] --say "<turn>"...` opens one session and prints the credential source, what loaded and
each turn's tokens. `--resume <id>` continues a session.
The relay ends any plan session whose init reports an API key.

## Gates

`./scripts/gates.sh` runs lint + typecheck, unit tests, the schema checks and integration tests (Docker). CI deploys on lint, unit and schema; integration runs in its own workflow and only reports.

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

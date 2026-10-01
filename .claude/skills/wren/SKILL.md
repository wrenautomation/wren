---
name: wren
description: Use wren for a client or for personal work. Covers adding a client, setting a client's research accounts, importing a CRM export, running reactivation (`crm run`, `crm status`, `crm top`), emails and sending (`crm emails|approve|skip|redraft|book`, `crm loop`), a client's settings (`clients set --set`), seeding the demo list (`crm seed-demo`), giving a client portal access, previewing the portal, and reading the send gate. Use when the user says "add a client", "import this CRM", "where is <client> at", "run the lookups", "who should they call", "seed the demo", "show me the portal", "give <client> access", or anything with `wren --client`.
---

# wren

Run the CLI as `./bin/wren` from the repo root. It rebuilds itself when the source changes.

## Layers

- **Foundations** are research, LinkedIn/web lookup, email checks and sending. They know nothing about clients. Use them directly for personal work.
- **Products** are built from foundations. Reactivation is `@wren/reactivation`. Products never import each other.
- **Clients** are registry rows. Each has its own database, research accounts and product settings. There is no per-client code.

The repos are public, so **client names never go in git**: not in code, tests, docs or this skill. A name lives only in the registry (`--name`). Use the client id in commits, and pick ids that don't name the firm.

## Clients

```sh
./bin/wren clients list
./bin/wren clients add <id> --name "<firm>" --account linkedin=linkedin
./bin/wren clients set <id> --account linkedin=<account>   # "linkedin=" turns it off
```

- `add` creates `wren_client_<id>`, migrates it and registers it.
- `--account site=account` names the autobrowse account the client researches from. No `linkedin` account means lookups use web search only.
- For now the LinkedIn research account is `linkedin`, William's personal profile. It is read-only: never post from it or log in again with it. autobrowse caps it lower than its default.
- Two clients sharing an account split one daily cap. `clients add` and `clients set` warn when that happens.
- `demo` is the demo client: masked, no login, no writes, no sends.

Every client command takes `--client <id>`. Without it the command refuses. It never falls back to the main database.

## Reactivation: the whole flow

```sh
./bin/wren crm formats                                          # crm-generic, hubspot, salesforce, bullhorn
./bin/wren --client <id> crm import <file.csv> --format hubspot
./bin/wren --client <id> crm run          # every stage that is due, in order
./bin/wren --client <id> crm status       # where it stands, and what to do next
./bin/wren --client <id> crm health       # duplicates, dead emails, staleness, owners, the send gate
./bin/wren --client <id> crm top          # who to reach first, why, and the brief (--limit, --json)
```

- `crm run` walks the stages in order:
  1. **verify**: check each CRM address once.
  2. **lookup**: where each person is now.
  3. **signals**: is each CRM company hiring? The firm's own job board first, LinkedIn jobs after.
  4. **score**: rank everyone by why to reach them now.
  5. **brief**: a few sentences per person, each citing the facts it stands on.
- **brief** needs a real LLM (`WREN_LLM`). With the fake one, the stage stops and says so; the rest still run.
- Ctrl-C pauses a run. Running it again resumes where it left off.
- A stage that aborts stops the run, and the exit code is 1. Read the stage line to see why.
- `crm status` always ends with a `next:` line. Do what it says.
- `--limit n` caps each stage for a trial run. `--no-linkedin` means web search only.
- `crm verify` and `crm lookup` run a single stage and are for debugging. `crm lookup --again` redoes people already looked up.

### Emails, sending, replies

```sh
./bin/wren --client <id> crm profile                   # the firm: voice, recruiters, signature
./bin/wren --client <id> crm profile set <file.json>
./bin/wren clients set <id> --set reactivation.on=true --set reactivation.stages.send=true
./bin/wren clients set <id> --set reactivation.senders.0.suspended=true   # paths go through arrays
./bin/wren --client <id> crm emails [--filter awaiting] # drafts; #ids are for approve and skip
./bin/wren --client <id> crm approve <ids...> | --all
./bin/wren --client <id> crm skip <ids...>
./bin/wren --client <id> crm redraft <ids...> | --all  # rewrite drafts still waiting, same sender (real model only)
./bin/wren --client <id> crm book <replyId> [--undo]   # a meeting booked: the billing unit
./bin/wren --client <id> crm loop start|stop|status
```

- The block under `reactivation` holds the client's settings: `on`, `stages`, `approval`, `sending` caps, `senders` (the mailboxes in Wren's Workspace), `offer`. `clients set` checks it before writing.
- `crm loop start` once per client. The loop works what is due every 10 minutes (verify only when free, score, briefs, emails) and runs each mailbox's inbox sync and sending. Lookup and signals stay `crm run`.
- `on` is the one switch. Off, the loop idles and stops the mailboxes. Sending needs `stages.send` too; it is off by default.
- `approval: first`: the client approves the first batch in the portal, then drafts flow. `every`: each batch.
- Interested and booked replies are forwarded by the loop, from their mailbox to the recruiter (`stages.handoff`, on by default). No recruiter in the profile: they wait. `crm loop status` shows the counts and any errors.
- `crm loop stop` stops the mailboxes too.

### The demo list

```sh
./bin/wren --client demo crm seed-demo --agency <url>   # --companies 40, --per-company 2, --csv <path>
./bin/wren --client demo crm run
```

- Builds the demo's list from a real agency's site: the customers its pages name, their sites, and people who hire there (or did). Owners, statuses and dates are made up, the same every time for the same agency.
- Wipes the demo's list first. Refuses on any client that isn't `demo`.
- Needs `WREN_FETCH_CONTACT` and a real LLM (`WREN_LLM`).
- Never write the agency's name into git. `--csv` copies go outside the repo.

### The portal

- `app.wrenautomation.com`: a client's own list. Sign-in at `auth.wrenautomation.com` (emailed code, Google, Microsoft, password), invite-only. Let someone in with `./bin/wren clients members add <id> a@firm.com [--role owner]`. Wren's own people: `./bin/wren operators add a@wrenautomation.com` (every client). Prod: run these against prod's `WREN_DATABASE_URL`.
- `demo.wrenautomation.com`: the `demo` client, no login, people masked.
- Look at it locally before showing anyone:

```sh
pnpm --filter @wren/portal preview          # localhost:8788, every client
pnpm --filter @wren/portal preview --demo   # as a demo visitor
```

- Setup, secrets and checks: `deploy/portal.md`.

### What the states mean

- **Send gate:**
  - `not verified yet`: run `crm run`.
  - `clean first`: more than 10% of checked addresses are dead. The list needs cleaning before anything is sent.
  - `ok`: sending may proceed.
- **Lookup states:**
  - `matched`: name plus firm confirmed, and findings written. Only a name-plus-firm match counts; a miss is fine, a false match is not.
  - `unresolved`: not found. No guess is made.
  - `parked`: a daily cap was hit. The person is picked up again once the cap lifts. `crm status` says `wait: … until <time>` when nothing else is due.
- **Findings** are `still_there`, `left`, `job_change` and similar. Each finding keeps its source document.
- **Company checks:**
  - `hiring`: open roles found. Rechecked after a week.
  - `no openings`: a board was read and it is empty. Rechecked after a week.
  - `unresolved`: no board found and no LinkedIn page we trust. Nothing is guessed. Rechecked after a month.
  - `parked`: a daily cap was hit. Rechecked when it lifts; the last real answer still counts meanwhile.
- **Scores:** open roles at a firm they are still at score highest, then a job change, then still there, then nothing found. Someone who left scores 0. A recent placement or contact adds a little. Every point has a reason in `crm top`.
- **Briefs:**
  - `written`: at least one sentence survived the gate. Only these show in `crm top`.
  - `empty`: every sentence cited something wrong or made up a number. Kept so the same facts aren't paid for again.
  - `failed`: the answer wasn't readable. Retried after a day.
  - A brief is rewritten only when its facts change. People who score 0, aren't looked up yet, or have no findings get none.

## Rules

- Don't spend: MillionVerifier uses free credits only. `--verifier smtp` is the default and costs nothing.
- Never compose, enroll or send for RIA leads.
- Don't restart wren's scheduled loops without William's say-so.
- To see how the system fits together, read `map/CLAUDE.md`, then one card.

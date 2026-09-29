---
name: wren
description: Use wren for a client or for personal work. Covers adding a client, setting a client's research accounts, importing a CRM export, running reactivation (`crm run`, `crm status`) and reading the send gate. Use when the user says "add a client", "import this CRM", "where is <client> at", "run the lookups", or anything with `wren --client`.
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
```

- `crm run` walks the stages in order: **verify** (check each CRM address once), then **lookup** (where each person is now).
- Ctrl-C pauses a run. Running it again resumes where it left off.
- A stage that aborts stops the run, and the exit code is 1. Read the stage line to see why.
- `crm status` always ends with a `next:` line. Do what it says.
- `--limit n` caps each stage for a trial run. `--no-linkedin` means web search only.
- `crm verify` and `crm lookup` run a single stage and are for debugging. `crm lookup --again` redoes people already looked up.

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

## Rules

- Don't spend: MillionVerifier uses free credits only. `--verifier smtp` is the default and costs nothing.
- Never compose, enroll or send for RIA leads.
- Don't restart wren's scheduled loops without William's say-so.
- To see how the system fits together, read `map/CLAUDE.md`, then one card.

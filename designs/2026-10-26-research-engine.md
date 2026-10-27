# Research engine: raven, weaver, falcon (2026-10-26)

Agreed with William 2026-10-26. The research product: an ask goes in, findings with sources come
out. Not a chat product. Every step is shown and stored. Perplexity is the analogy for the shape
(planner, retrievers, reader, synthesis), not for the surface: Perplexity hides its queries and
hits, we write each one down, because the written query is where William steps in.

## Flow

plan, fetch, read, extract, call. A line on the metro map, lowered to an NFA like every other line:
linear by default, with edges back to an earlier step or a restart of one step, each with a reason.
Judgment sits in every step. Only the call writes state the rest of the system trusts.

| Step | Does | Who |
|---|---|---|
| plan | ask + what is known + plan file → typed queries and a plan of actions | raven |
| fetch | query → hits → documents, through one source interface | weaver |
| read | document → text, frames, speech | falcon |
| extract | text → candidate findings with proof | falcon |
| call | keep or drop, with a note; the label | William or a rule, in wren |

A query: `{ask, kind: web|video|channel|person|site, site?, terms, why, from: ai|human}`.

Filters, three grains, no score column anywhere:
- before the read, on the hit: raven decides read or skip from what a hit shows for free (title,
  channel, length, date, snippet) and the yield table.
- after the read, on the finding: falcon extracts against the ask. A document that yields nothing
  is the filter result. Falcon proposes; it never keeps or drops.
- the call: the final filter and the label.
Good and bad are learned afterward from the yield table (hits, reads, proposed, kept, per source,
channel and ask kind). Raven reads it next time. A bad channel is skipped because it never
yielded, not because a rule said so.

## Products

Three public npm packages under the `@wrenautomation` scope. No database. Each useful alone.

- **raven**: ask → plan. Owns the query type. Depends on nothing.
- **falcon** (scribe today, renamed at 3.5a): document → text → findings. Takes bytes, text or a
  local media file path. Owns the document and finding types. Keeps `text`, `watch`, the video
  and audio readers over a local file, `htmlText`, `pdfText`, the study extractors. Depends on
  nothing.
- **weaver**: query → hits → documents, the runner that drives the line, and the ledger contract.
  Holds every source adapter: autobrowse sites, SearXNG, Exa, the connectors, the polite fetcher
  and fetch ladder, robots, yt-dlp (search, list, captions, download). Depends on raven and
  falcon. `weaver` CLI runs an ask against a files store.
- **autobrowse**: one source behind weaver's interface, the only one with a browser. Name stays.

Dependency cut: one direction only. The composer depends on its steps; the steps know nothing of
each other or of the order. The order is data (raven's plan, the NFA weaver runs), not code
structure, so a loop edge or a cheap-read-first pass changes a plan file, not a package. No shared
types package: each type lives where it is produced, weaver imports both.

What moves out of scribe when weaver is built: the `fetch` door's fetcher, ladder and robots;
`flatPlaylist`; the yt-dlp calls inside the video readers (readers take a local file plus optional
caption text). `htmlText` moves to `text`. The package is renamed falcon in the same release
(`@wrenautomation/falcon`, repo `wrenautomation/falcon`). Nine wren pins change once.

## Extension

Each a registry or an injected seam, never a flag.

- weaver, sources: a source is one adapter file (name, kind, cost class, the two calls),
  registered by name. A Perplexity API adapter is one such file: registered, unused until a plan
  names it. Which sources run is per run, as data: the plan file per ask kind holds an allow-list,
  raven picks from it, a run can override. The registry holds fifty; a run uses three. Every call
  writes its cost to the ledger. Hits dedupe by canonical URL in weaver, and a hit keeps the list
  of sources that returned it: two sources agreeing is a signal, not a duplicate.
- raven, proposers: the plan step is proposals merged into one plan. Every query carries `from`
  (ai or human) and `by` (which model, plan file or person proposed it). One proposer today. A
  second model, plan file or teammate adds proposals; the yield table per `by` says who finds the
  good stuff. No debate rounds until a second proposer exists.
- falcon, readers: a registry keyed by media type (html, pdf, video, audio, image, slides, code,
  spreadsheet). A new kind is one reader.
- falcon, extractors: one roughly typed interface per finding kind (claim, pain, design pattern,
  entity, number). The plan names which run. New finding and proof kinds (quote, timestamp, frame,
  box) are additive.
- the model seam: the existing LLM client interface, injected per step. In a terminal the model
  is Claude Code itself.
- rejected: read depth (cheap read first, full read if the sample yields). Full ingestion by
  default until it costs too much.

## The human seam

One mechanism everywhere, not a special path: every interface can be implemented by a person, and
every record carries `by`. In weaver, a `paste` source: URLs, images or text William hands over
become hits and documents by human. In raven, a plan or a query he writes is a proposal by human,
merged like any other. In falcon, a highlight he makes on a page, a finding he adds, or a
regrouping of findings is a finding by human with its proof. The call is his by default. The
ledger shows all of it beside the AI's, in the same rows.

SearXNG (self-hosted metasearch, Docker, fans one query out to Google, Bing, Brave, DuckDuckGo,
YouTube, Reddit and more, merges hits, JSON out, no keys, no tracking) is the web search source.
Exa stays for search by meaning. Google by browser stays as the fallback when SearXNG is blocked.
Reads stay where they are: open pages by the fetcher, blocked and logged-in sites by autobrowse,
video by yt-dlp.

## The ledger

Three grains, three words. A record is one row: a query, a hit, a document, a finding, a call. A
trace is one run's rows (the same word as autobrowse traces and executor events). The ledger is
the whole append-only store: every record with who wrote it and why, plus raven's input snapshot
per round (what was known, plan file version, model id), kept forever. The records are the RL
trace: state, action, outcome per step; the call is the label.

The ledger is a contract in weaver, not a wren table. Two backends:
- wren Postgres: the business. Tenancy, audit, the portal Research app, the nightly lake sync.
- files: a folder in any repo (William's personal dev site). Weaver runs there from a terminal,
  calls are made by CLI, the build starts from the kept findings. No wren.

Formalization: plan files per ask kind, written by the run that worked, versioned and tuned like
SOPs, stored beside the ledger. Tuning lives there, never only in a session. The yield table is a
fact table beside it.

Wren is the business face, not a fourth product. It holds one ledger backend, the SOPs, the rules
that make calls, and the surfaces: the portal, Ask, the agent CLI, all writing the same records. A
downstream build (the dev site) starts from kept findings and files a new ask if it needs more; it
never reaches back into fetch or read.

Lines call the engine as their find station: launch-films, study, pain. Learn stays parked and
later becomes one consumer of the ledger.

## Actors and slots

A slot (plan, a read, an extract, the call) is filled by a person, a model call or an agent. The
rest of the system sees the same record with its `by`. Handing a slot over is a change of
implementation, not of structure.

Three actors on one axis of trust. Humans label (the call). Model calls propose and are measured
against the labels. Agents are model calls with loops, allowed in a slot only when their inner
steps write records too: a black box between two records is untraceable and unlearnable, and the
ledger forbids hidden steps.

v1: every slot is one typed call, input in, record out. No subagents inside the engine. A loop is
an NFA edge with a reason and a new round with a new snapshot, never an inner loop nobody sees.
The one agent is the terminal: Claude Code calls raven, weaver and falcon as tools, William makes
the calls beside it, the ledger records both.

Stepping back is measured, not felt: when William's calls stop changing the proposals for an ask
kind, a call rule takes the slot (auto-keep when this proposer agreed with him on the last N calls
of this kind). Deleting the rule steps forward again. Not v1; the rows that make it possible are.

## Phases

- 3.5 **Query layer** (between ingestion phase 3 and 4; `2026-10-25-ingestion-engine.md`):
  a. the dependency cut and the rename: fetch, playlist and yt-dlp out of scribe into weaver;
     readers over a local file; scribe becomes falcon;
  b. raven: query type with `from` and `by`, proposals merged into a plan, planner over a plan
     file, read-or-skip on hits, loop edges. Raven alone, proven by its CLI and tests; no wren
     wiring (see the 10-27 log);
  c. weaver: source interface, registry with per-run allow-list, runner, dedupe, cost per call,
     ledger contract, files backend, CLI; sources autobrowse sites, SearXNG (Docker), Exa, paste,
     the ledger itself; falcon's Document, Finding and Proof types; raven 0.2 (usage on `ask`).
     Shape in "3.5c weaver" below;
  d. wren: ledger tables (query, hit, document, finding, call, snapshot, yield), the Postgres
     backend, the pain and study lines' find stations onto weaver, agent CLI (list, add, edit,
     answer a query; keep, drop a finding), portal ledger page. The study is rewritten as the
     first line on the engine in one move: its rows become ledger records, its loop
     (`studies/run.ts`) and falcon's planner (`study/claims.ts` PLAN) are deleted, the CLI is
     reshaped around the records (`wren study` a thin ask over them).
- 3.6 **Extract and call as one shape** across lines: one call command, one call page, so the
  designer-site example runs end to end.
- 3.7 **Ask**: a thin surface over the same records.
- 4 **Port the old hardcoded workflows** to lines, onto the shared find station.

## 3.5c weaver (agreed 2026-10-27)

Goal: `weaver run "<ask>"` in any folder runs the whole line from a terminal, writes every record
to a folder, and the same steps mount as stations in wren's executor at 3.5d. No wren.

Pieces:
- Ports, injected as one plain `deps` object, no container: `Source`, `Ledger`, `Model` (raven's),
  `Reader` and `Extractor` (falcon's), `clock`, `ids`.
- A source is one file: `{name, kind: search|open|both, cost: free|metered|browser,
  search?(query) → HitView[], open?(hit) → Document}`, registered by name. The plan's allow-list
  picks per run. Every call returns `{result, cost, error?}`; the runner writes one `call` record
  per call, success or failure. First adapters: SearXNG, Exa, the polite fetcher, the ladder over
  the site client, yt-dlp search and read, `paste` (human), the ledger itself.
- Dedupe by canonical URL (host case, tracking params, trailing slash, YouTube id forms). A hit
  keeps `sources[]`; two sources agreeing is a signal.
- Runner: a small interpreter over a step table. Steps are typed calls (plan, fetch, triage, read,
  extract, review), records in, records out. Raven's edge picks the next step; the runner checks
  that `to` names a real step. State is the fold of the run's records, never held in memory, so
  `--resume <run>` continues after the last complete step.
- Ledger contract: `append(record)`, `trace(run)`, `scan(filter)`, `yield(filter)`. Records:
  query, hit, document, finding, call, snapshot, edge. Append only. Each carries `id` (ULID made
  by the writer), `run`, `round`, `step`, `at`, `from`, `by`. A correction is a new record that
  points at the old one.
- Files backend: `ledger/runs/<run>/<by>.jsonl`, one file per run per writer. Append is one line.
  Trace is the union of the files sorted by `at`, so two sessions on one run never touch the
  same file and git merges clean. DuckDB reads JSONL directly, so the lake sync is a query.
  Postgres implements the same four calls in wren. Plan files beside it, `ledger/plans/<kind>.json`.
- Falcon gets the `Document`, `Finding` and `Proof` types and a reader registry keyed by media
  type. Finding v1: `{kind, text, proof: {url, quote | timestamp | frame}, from, by}`, with the
  claim extractor as the one extractor. Watch for three signs it is too thin: a finding needs two
  proofs, a proof needs a span inside a quote, a finding points at another finding.
- Raven 0.2: `Model.ask` returns `{value, usage}` so the ledger gets cost per model call.
- Autobrowse: weaver defines the `SiteClient` port (the ladder's `LadderClient` today).
  Autobrowse ships `@wrenautomation/autobrowse/sites`, an HTTP client without the browser stack,
  that implements it. Neither imports the other; the types meet by structure in wren. Weaver tests
  use a fake client.
- CLI, JSON out: `weaver run`, `weaver trace <run>`, `weaver keep|drop <finding> -r "..."`,
  `weaver yield`, `weaver sources`. Claude Code is the agent: it runs the line, reads the trace,
  makes calls.

Decisions, options weighed:
- Runner: a hand-rolled loop (order in code), steps only with the caller sequencing (the CLI
  needs a loop anyway), or a step table plus an interpreter (order as data). The table: the loop
  lives once and wren's executor mounts the same table.
- Files backend: JSONL per run, one JSON per record (thousands of files), SQLite (native
  dependency, binary in a repo). JSONL per run per writer.
- Autobrowse: depend on the npm package (a browser stack in a planner), or an injected typed
  client. The client; the dependency direction matters more than the import size.
- CRDT for multiple agents and people: parked. The ledger is a grow-only set with writer ids,
  which merges by union with no library. A CRDT (Yjs, Automerge) would matter only for text two
  people edit live (a plan file, a report); that goes under that document type if the need shows.

Priorities: traceable over fast; order as data; no dependency from a product back to wren;
resume from the ledger.

Build order (WA-899, one session, no subagents): 1. ledger contract, record shapes, files backend;
2. ports and the source registry with a fake source and a fake site client; 3. the step table
and runner with resume; 4. adapters: SearXNG, Exa, fetcher, ladder, yt-dlp, paste, ledger;
5. falcon release with Document, Finding, Proof and the reader registry (weaver pins it);
6. raven 0.2: `ask` returns `{value, usage}`, `parseAnswer` finds the JSON object by brace
balance not the first brace, the runner (not raven) checks `Edge.to`; 7. autobrowse `./sites`;
8. CLI, JSON out; 9. one real run from a terminal, tune the prompts and the Finding shape from
its trace; 10. publish by `v*` tag, same trusted-publisher recipe (first publish by hand only
if the package is new; weaver is not).

Open until the first real run: the Finding shape; the five raven prompts; whether AskKind stays
a closed enum (reopen if a sixth plan file appears); the yield row grain (per source and `by`
today, channel and ask kind when the rows exist).

## Out

- A score column. Scores are learned from yield.
- A strict loop with a stop rule. Budget is a guard rail; raven records why it stopped.
- A rename of autobrowse: the name says the job.
- Subagents inside the engine (v1). Call rules that auto-keep (after v1, from the ledger).
- Read depth. Full ingestion by default.
- A name for the call: it is wren.

## Log

- 2026-10-26: conception agreed. Names: ferret → raven, reach → weaver. Dependency cut agreed in
  principle. Nothing built yet; scribe 0.2.0 still holds fetch and the yt-dlp readers (WA-886).
  Phases wait on William's greenlight.
- 2026-10-26, later: scribe → falcon at 3.5a. Read depth rejected (full ingestion). Extension
  seams and the human seam written down: weaver adapters with a per-run allow-list, raven
  proposers with `by`, falcon reader and extractor registries. Actors and slots: one typed call
  per slot in v1, no engine subagents, agents later only if they trace; hand-over measured from
  the ledger.
- 2026-10-27: 3.5a built (WA-890). Sorting rule: code that takes a URL or spawns yt-dlp went to
  weaver (`@wrenautomation/weaver` 0.1.0, repo `wrenautomation/weaver`: fetcher, robots, ladder,
  `readYoutube`/`readYoutubeByUrl`/`readVideo`/`readAudio`, `watch` over a URL, `download`,
  `flatPlaylist`, CLI `weaver fetch|read|list`); code that takes a file, bytes or text stayed and
  scribe became falcon (`@wrenautomation/falcon` 0.3.x, repo `wrenautomation/falcon`: text,
  `watch` over a file, `hearAudio`, `renderWatched`, `runFor`, study). weaver pins falcon exact.
  wren pins both in nine packages; 81 imports moved; `layers-guard` names weaver. Both repos
  publish on a `v*` tag by npm trusted publishing. Next: 3.5b raven.
- 2026-10-27, later: 3.5b built (WA-897). `@wrenautomation/raven` 0.1.x, repo
  `wrenautomation/raven`, depends on nothing of Wren's (zod, commander). Shapes: `Ask`, `Query`
  (`kind`, `terms`, `site?`, `why`, `from`, `by`), `Proposal`, `PlanFile` (per ask kind: `propose`,
  `triage`, `review` prompts, `sources`, `budget`), `Plan` with a `Snapshot` (known, plan file
  version, model id), `HitView` (what a source shows for free; raven owns it because weaver
  depends on raven), `Triage`, `Round`, `Edge`. Calls: `plan` (proposals merged, human first and
  never capped, sources narrowed never widened), `triage` (read or skip per hit under the read
  budget; an unnamed hit is a written skip), `review` (round budget stops without a model call,
  else the model's edge with why). Model seam: an injected `Model {id, ask(prompt, shape)}`;
  the CLI makes any command the model, `claude -p` by default. Five default plan files
  (`raven plans <kind>`). Decision (William, 10-27): no stepping stone onto the old study loop;
  the study moves onto the engine whole at 3.5d (phase text above). Rule: a stepping stone is
  allowed only if the doc names the phase that deletes it. Next: 3.5c weaver.
- 2026-10-27, later: 3.5c agreed (WA-899), section "3.5c weaver" above holds the shape, the
  options weighed, the build order and the open items. CRDT parked. Nothing of weaver's engine
  built yet; weaver 0.1.0 holds fetch and the video readers from 3.5a.

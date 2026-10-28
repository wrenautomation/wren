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
- 5 **Learn onto the ledger**: breakdowns as finding records, his calls as call records;
  `decision_calls` kind `finding` and the SOP branch of `linePass` go. Learn stays parked
  until then.

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

Built (2026-10-27, weaver 0.2.0), what the build decided beyond the agreed shape:
- Records carry a `type` discriminator; `LedgerRecord.parse` at every write, so a bad line
  never lands. Two records were added: `spend` (one per source or model call, `on` the record
  it served, `ok`, `cost`, `ms`, `usd?`) replaces the "call result" of the agreed text, and
  `done` closes a run with its note. `call` is the verdict (`keep`|`drop`, `on` a finding, `why`).
  `From` gained `tool`: a source or the runner, neither a model nor a person.
- A finding is kept unless its latest `call` is a drop. The run is finished when the last edge
  is `stop`. Resume folds the run's records per step, so a run continues from the step it
  stopped on, and a `--no-model` run stops at extract with its reason in the ledger.
- The allow-list goes in as the plan file's `sources` (raven narrows to the plan file, never
  widens), and the runner adds every opener here unless `--sources` was given by hand. The
  fetcher yields a YouTube URL to the youtube source. A `Source` may carry `by`: a paste's
  records are by the person, not by "paste".
- The model: `claude -p --output-format json` by default (Claude Code headless, as agreed), or
  `--model gateway[:alias]` for Wren's LLM gateway (`WREN_LLM_GATEWAY_URL`, `_TOKEN`, OpenAI
  chat completions, raven's `parseAnswer`), or any command. The first real run went through the
  gateway: `claude -p` inside a Claude Code session has not answered yet (open).
- Autobrowse: no `./sites` subpath was needed. The wire is one URL shape
  (`/api/sites/<site><path>`, a bearer, GET input in the query), so weaver carries a 30-line
  `httpLadderClient` behind its own `LadderClient` port; autobrowse exports one if the wire grows.
- First real run (two pasted pages, the gateway `free` alias): plan, fetch, triage, read,
  extract, review, stop, 3 findings with their quotes, 2 minutes, all metered calls in the
  ledger. The tune it asked for: falcon 0.4.1's claim prompt states the fact, never "the
  document says". Finding v1 held; the three signs did not show.

## 3.5d wren (agreed 2026-10-27)

Goal: the study runs on the engine inside wren. Every record lands in Postgres. The map's find
stations read the ledger. One agent CLI runs over both ledgers. The pain line follows the study.
Wren adds no engine code: it holds a ledger backend, a model adapter, source adapters and the
surfaces. Everything else is weaver, raven and falcon as published.

Pieces:
- `PgLedger`: the four calls (`append`, `trace`, `scan`, `yield`) over one table. Every write
  goes through `LedgerRecord.parse`, like the files backend.
- A model adapter: raven's `Model` over wren's `LlmClient` (`ravenModel(llm)`). `ask` is
  `completeAndParse`; `usage` comes back so the runner's `spend` row carries tokens and USD
  (`model-prices`). Falcon's extractor takes the same adapter.
- Sources on this host: searxng, exa, the fetcher, the ladder over wren's `SiteClient`,
  youtube, paste, the ledger, and `reach-posts` (the pain line's find: posts at or over the
  platform's `minFit` since the cursor, as hits; a post opens as a document).
- Extractors: falcon's `claim` for the study; `pain` (a stated pain with its quote) for the
  pain line, in falcon, kind `pain`. Every extract also returns a verdict on the document:
  `quality` (rich, thin, off, empty) and `gap`, one sentence on what the ask still lacks.
  Weaver writes it as a `verdict` record on the document; raven's review reads the round's
  verdicts and gaps before it picks the edge. Falcon is a filter with a report, never a
  planner: it names no query.
- The run object: `Research` virtual object in the worker, keyed by run id. One handler,
  `step`, runs one weaver step (`steps: 1`) against the Postgres ledger and sends itself the
  next. A step that throws a transient error (a source's 429 or 5xx, the network, the model's
  overload) leaves no `done` record and is retried with backoff, 5 tries, then the object
  writes `done ok: false` with the note "parked after 5 tries" and stops; `resume` restarts
  it. A logical failure (the model refused, the edge named no step) writes `done ok: false`
  at once. A wait (a source said "not before T") is `ctx.sleep` to T. `submit(ask)` creates
  the run and the first step; `stop` ends it. The CLI submits and tails the trace.
- The study: `studies` keeps `slug`, `question`, `angles`, `drafts` (the spec), `niche`, and
  gains `run` (the engine run; a redo is a new run, resume is the same run). The angles become
  human proposals (`from: human`, `by: william`) merged into round 1. Claims are finding
  records; his calls are call records; `add-page` is the paste source. Drafts and the report
  are the synthesis reader: falcon's `drafts` and `report` over the kept finding records, the
  text kept in `study_drafts (study_id, kind, basis, text, at)`, redrawn when `basis` changes.
- The find station: a `study: <slug>` find takes the document records of the study's runs.
  Read ends on arrival (a document record is a read page). Extract ends when the round's
  extract step has its `done` record. Call ends when every finding on the document has a
  call, or the document has no finding.
- The pain line: one open run per platform, a `Research` object each. Its `reach-posts`
  source answers "not before T" when the cursor has not moved, so the object sleeps 15
  minutes between passes and never polls by the minute. The `trigger.source` fire reads
  the ledger's finding. `PainFeed`, `painPass` and the pain rows in `findings` go.
- CLI: `wren research run|trace|keep|drop|yield|sources`, weaver's own commands with the
  Postgres ledger, wren's sources and the model adapter injected (`addEngineCommands(program,
  deps)`, new in 0.2.2). `wren study new|run|report|call|add-page|list` stays as the recipe
  layer over them: `run` is `research run` with the study's ask and proposals; `call` is
  `keep` or `drop` by report number, `tune` is `keep` with his words.
- Import: each existing study becomes one run. Read pages become hit and document records,
  claims finding records, his `decision_calls` on them call records, drafts rows. One script,
  run once on prod, then `study_steps` goes. His calls are the labels; the ledger keeps them.

Decisions, options weighed:
- Record shape in Postgres. (A) One append-only table `research_ledger`: the envelope as
  columns (`id`, `run`, `round`, `step`, `at`, `from`, `by`, `type`), the rest `body` jsonb, a
  GIN index on `body` for `on` and `document`, `client` null for Wren. (B) One table per
  record type, nine tables, typed columns and keys. (C) `documents` and `findings` for those
  two grains, (A) for the rest. (A). The contract is four calls over records, the files
  backend is one stream, DuckLake reads one table, and a files ledger from a personal repo
  imports by copying rows. (C) fails on shape: `findings` has `fact_key`, `via`, `confidence`
  and a three-value `by`; the envelope has a ULID, `run`, `round`, `step` and a free `by`.
  Not named `ledger`: wren's ledger cluster is imports and runs.
- Where a run executes. (A) The Mac, by the CLI, as the study runs today; the worker's
  `LineFeed` reads the records. (B) A Restate object per run, one step per call, re-armed
  until the run stops. (C) A worker loop that advances open runs a bounded number of steps
  per pass. (B), William's asks: retries mid-way, durability, branching over sources with
  one failure isolated, waiting for a source. The ledger already holds state; what (B) adds
  is progress with nobody at a terminal, bounded retries with backoff, sleeps, and one
  object per run so runs never share a loop. (A) stays for one case: an ask that names
  youtube runs on the Mac by the same runner against the Postgres ledger, because yt-dlp
  needs a home IP. The desk `video` endpoint (below) deletes that case. (C) is (B) with a
  shared loop and no reason.
- Retries, two layers. Inside a step, weaver: the sources fan out in parallel; each call is
  timed and isolated, a throw is one failed `spend` and the others keep their hits; a
  transient error is retried 3 times with backoff inside the call; a source that gives a
  retry-after writes it on the spend. A fetch is ok when one source answered; the failed
  ones are notes to the review, which may say back to fetch. Between steps, the run object
  (above). The rule that makes both safe: every step is a fold over its trace and skips what
  the trace already has (a source whose spend in this round is ok is not called again), so
  a retry and a resume redo only what failed. The spend record is the checkpoint.
- Hosts. Lambda runs the object with exa, the fetcher, the ladder (autobrowse desk), paste,
  the ledger, reach-posts and the model. SearXNG moves to the RackNerd VPS next to mailifier
  (a datacenter IP draws captchas sooner than a home IP; SearXNG spreads over Bing,
  DuckDuckGo and Brave, so it degrades, not dies; the first runs measure it, the Mac through
  the desk is the fallback). yt-dlp stays on a Mac and reaches Lambda through the autobrowse
  desk: a `video` endpoint beside `web GET /fetch` that runs weaver's youtube source and
  returns the document. The video reader is already one door (weaver `./video` over a URL,
  falcon `./video` over a file; learn, studio, the research SOPs and the engine's youtube
  source all import it); what was missing is a network door, and the desk endpoint is it.
  The youtube source takes a client port (local reader or desk), like the ladder.
- Cost. Lambda stays under its free tier (1M requests, 400k GB-seconds a month, for ever): a
  run is about 30 steps of 15 s at 1 GB, 450 GB-s, free; a pain object that woke every minute
  would spend half the tier, so it sleeps 15 minutes. Concurrency cap stays 6. The box is the
  $24 and does not change. A container on the box (4 GB, with Postgres, Chrome and Restate)
  would fight Chrome for memory: no.
- The old study rows. (A) Import into records. (B) Archive read only. (C) Drop. (A): his calls
  are the labels, and the ledger is kept forever by its own rule.
- Two call stores. Engine lines' calls are ledger records. SOP and learn calls stay in
  `decision_calls` kind `finding`. Phase 5 deletes the second store; the SOP branch of
  `linePass` goes with it.
- Falcon `./study`. (A) The planner goes: `buildPlanPrompt`, `planQueries`, `QueryPlan`,
  `pickReads`, `Hit`, `buildClaimsPrompt`, `gateClaims`, `ClaimProposals`; the `claim`
  extractor in `./document` is the one extractor. `drafts`, `report`, `grounding` and
  `evidence` stay as the synthesis reader over kept findings; `enrichment/opener.ts` keeps
  its grounding imports. (B) Keep the planner unused. (A): dead code is a second way.
  Falcon 0.5.0.
- The portal ledger page. (A) Now, in the Research app. (B) At 3.6. (A), William's call:
  runs, a run's trace by round and step, findings with keep and drop, spend, parked runs
  with their note. CSS from the Design Language artifact per the match check.
- Launch-films: an SOP line in learn; parked with learn until phase 5. Out of 3.5d.

Weaver 0.2.2 first (WA-905 plus five): `--model anthropic[:model]` on `@anthropic-ai/sdk`;
`RunOptions.steps` (default 64, the loop's bound today); `addEngineCommands(program, deps?)`
with the ledger, sources and model injectable, the files backend the default; parallel
sources with per-call retry and `retryAfter` on the spend; `Transient` errors thrown past
the runner (no `done` record) and steps idempotent over their trace; the `verdict` record.
Falcon 0.5.0: the planner out, `Extracted.verdict` in. Raven 0.2.2: the review prompt takes
verdicts and gaps. Weaver re-exports the types wren needs, so wren pins no raven.

The personal-project test comes before the wren build, not after: `weaver run` in a folder
of William's project repo on the files backend, `--model anthropic`, SearXNG up, his asks.
The open items of 3.5c (the Finding shape, the five prompts, AskKind, the yield grain) settle
on real traces before Postgres and nine pins freeze them.

Build order (one session, no subagents): 0. falcon 0.5.0, raven 0.2.2, weaver 0.2.2,
published; SearXNG on the VPS; 1. William's runs on the files backend; prompts and plan
files tuned from the traces; 2. migration `research_ledger`, `PgLedger`, tests on the
contract; 3. the model adapter, the source set, `wren research`; 4. the `Research` object
in the worker, `submit`, `step`, `stop`, a test with a source that fails once; 5. the study
on the records: `studies.run`, `study_drafts`, `wren study`, the loop in `studies/run.ts`
deleted, the import script; 6. `linePass`'s study branch reads records; 7. the pain line:
`reach-posts` source, `pain` extractor, one object per platform, `PainFeed` deleted;
8. the portal ledger page; 9. nine pins to weaver 0.2.2 and falcon 0.5.0; 10. map cards
(research/study, a new research/ledger, platform/journey), the research skill, gate, push,
the import on prod. After: the desk `video` endpoint (autobrowse), then the Mac case goes.

Out of 3.5d: launch-films (phase 5), lines in client workspaces (main only, like `studies`),
the desk `video` endpoint (autobrowse, right after), the inventory of old recipes, templates
and SOPs against plan files (WA-908, after the first runs show what a plan file carries).

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
- 2026-10-27, later: 3.5c built (WA-899). weaver 0.2.0: doors `./engine` (ports, registry,
  step table, runner, fold), `./sources` (searxng, exa, youtube, fetcher, ladder, paste, ledger),
  `./ledger` (records, `FilesLedger`, `MemoryLedger`, yield); CLI `weaver
  run|trace|keep|drop|yield|sources`, JSON out. falcon 0.4.0 (the `./document` door) and raven
  0.2.0 (`{value, usage}`) shipped for it; falcon 0.4.1 tuned the claim prompt after the first
  real run. "Built" under "3.5c weaver" holds what the build decided. Next: 3.5d, the study and
  wren's executor stations onto the engine, Postgres as the second ledger.
- 2026-10-27, later: 3.5d agreed (WA-907), section "3.5d wren" above: one `research_ledger`
  table, the study on the records with its old rows imported, the Mac runs the study and the
  worker loop runs the pain line, falcon 0.5.0 drops its planner, weaver 0.2.2 first (Claude
  direct, a step bound, injectable CLI deps), the personal-project test on the files backend
  before the wren build. Portal page deferred to 3.6; learn and launch-films to a new phase 5.
  Nothing of 3.5d built yet.
- 2026-10-27, later still: William's reading changed four picks, logged in place. The run
  executes as a Restate object per run in the worker (his asks: retries, durability,
  branching with isolation, waits), with two retry layers and the spend record as the
  checkpoint; falcon is a filter with a verdict and a gap per document, raven keeps the edge;
  the portal ledger page is in 3.5d; SearXNG moves to the VPS and yt-dlp reaches Lambda
  through a desk `video` endpoint, the video reader itself already one door. Lambda stays
  under its free tier; the box is the cost. Weaver 0.2.2 grows to six changes, raven 0.2.2
  takes verdicts. WA-908 holds the old-recipes inventory.
- 2026-10-27, evening: step 0 published. falcon 0.5.0 (planner gone, `Verdict` on the
  extractor), raven 0.2.2 (`Round.verdicts` in the review prompt), weaver 0.2.2 (`--model
  anthropic`, `Transient` with three tries per call and every attempt a spend, `verdict`
  record as the extract checkpoint, fetch fans out per query and read/extract four at a
  time with records in order, `RunOptions.steps`, `addEngineCommands(program, deps)`, raven's
  host names re-exported). Smoke on the files backend with Claude Haiku direct over one
  pasted RFC: one round, 11 proved findings, a `rich` verdict, tokens on every ask spend.
  Known cost on a rare path: a non-Transient throw from one document's extract fails its
  batch of four before any finding or verdict of that batch is written, so a resume asks the
  model for all four again (the serial code kept the earlier ones). Wren's root-door imports
  of falcon's planner names break only at step 4, when `studies/run.ts` goes. The Mac's own
  Anthropic key: none in the model keys file yet; the smoke used prod's from `env-2`.
- 2026-10-27, night: weaver 0.2.3 and 0.2.4. `--model anthropic` is the default (Claude Haiku
  direct). Each extract batch's findings and verdict land as the batch settles, so a plain
  throw from one document costs a resume only the documents without a verdict (the rare-path
  cost above is gone; test in `engine.test.ts`). Claude's output cap is 8192 (an extract with
  its quotes passed 4096 on a live run; a cut answer now says so instead of failing the parse).
  SearXNG is live on VPS box 1 (`deploy/vps/`, profile `search`, 350 MB cap, 148 MB in use;
  Caddy 401s without the bearer, SSM `/wren/prod/searxng_token`; A record by the Cloudflare
  API, no browser needed). weaver's `searxng` source sends `SEARXNG_TOKEN` as a bearer. The
  Mac's model keys file now holds `SEARXNG_URL`, `SEARXNG_TOKEN` and `ANTHROPIC_API_KEY`
  (copied from autobrowse's store). Live run from the Mac, searxng + fetcher, Haiku: 3 rounds,
  66 hits, 9 documents, 65 findings; the resume after the cut answer asked for one document.
  Lambda's `SEARXNG_URL`/`SEARXNG_TOKEN` in `env-2` wait for step 3.
- 2026-10-27, late: decisions with William, not built yet. (1) Model by slot: plan, review and
  the per-round compaction of known on Sonnet 5.5; triage and extract on Haiku. Home: a `models`
  block in the plan file per ask kind, `--model` the fallback. (2) No hard cutoffs on extraction:
  falcon's 60/80-word gate goes; a cap stop continues from the last whole quote on the rest of
  the page (calls linear in facts, not a tree: billing is linear per token, so splitting saves
  nothing). Triage's 240-char snippet stays (a read-or-skip signal, the page is read after).
  (3) Tokens shrink by restating less: a why on reads only; the extractor gets a Sonnet brief of
  known, not the whole list (the one term that grows with rounds squared). (4) The engine's calls
  stay single turn; chat lives in the agent above it (Claude Code now, the Ask page later). A
  `steer` record (free text, `by: human`, per round) enters every prompt under "the person
  says"; `run --pause` stops after each round. (5) No human-seam package: the ledger contract
  (`by` and `from` on every record) is the decoupling; extract shared surface code on its second
  or third use.

- 2026-10-27, evening: (1), (2) and (5) built; falcon 0.6.0, raven 0.3.0, weaver 0.3.0 on npm
  (wren still pins the old three until step 2). Item (3) and the known-list compaction are not
  built, by William's call: the full known list stays. Falcon: the claim prompt caps nothing; an
  adapter throws `Cut` (text so far, tokens) on an output cap stop, the extractor keeps the
  whole findings before the cut, gates them, and asks again from the last kept quote with those
  findings known (`Extracted.continued`). Weaver writes that spend as one that worked, with its
  tokens. Raven: `Ask.steer` rendered first in every prompt ("The person says:"), plan files
  version 3, triage `why` on a read only. Weaver: `steer` record (`from: human`, no step),
  `weaver steer <run> <text>`, `run --steer`, `run --pause` (the loop stops after a review that
  says again; no exit code; `--resume` goes on). Decision: a paused run's `rounds` is the
  pointer, one ahead of the reviews done; the CLI note counts edges. Comparison, same ask
  ("how do staffing firms win repeat clients", Haiku, searxng + fetcher, 3/6/3) on 0.2.4 then
  0.3.0: documents read 9 → 14 (reads that landed 9 of 14 → 14 of 16; the old run lost one extract
  to a malformed answer, the new run lost none), findings 65 → 90 (7.2 → 6.4 per document), model input
  tokens over all steps 93k → 142k, output 34k → 44k; the extract step alone per document:
  input 8.0k → 8.4k (the known list grew with the findings), output 2.8k → 2.5k, triage output per hit 111 → 82 tokens, triage `why`
  text 5.1k → 3.0k chars. No answer hit the cap, so no continuation ran. Verdicts still thin
  (13 thin, 1 off): the ask, not the engine. Live CLI smoke `pause-smoke`: `run --pause` stopped after round 1, `weaver steer` wrote the
  record, `--resume --pause` ran round 2 with the line in the snapshot ask and in the review's
  own words. Ledgers and `compare.py`: private tasks repo, `docs/10-27/engine-runs/`.
- 2026-10-27, night: `@wrenautomation/models` 0.1.0 (repo `wrenautomation/models`, public). The
  one door to every model call in every repo: wren, autobrowse, raven, falcon, weaver. Home
  options weighed: (A) falcon owns the model seam (it already held `Cut`); (B) a new package
  that depends on nothing of Wren's; (C) wren's `@wren/llm` made public. William's pick, B:
  falcon decides, it does not dial vendors, and a model door inside falcon would make raven and
  autobrowse depend on a reader. No CI guard: this entry and the models README name the rule.
  Substrate options: each vendor's own SDK (four call shapes, four usage formats), plain
  `fetch` (every wire by hand), the AI SDK 7 (one call shape, media parts, token details per
  vendor). Pick: the AI SDK, SDK retries off. Models adds only what the SDK leaves out: errors
  sorted by what to do next (`Transient`, `Refused`, `InputRejected`, `Unsupported`, `Cut`,
  `NoAnswer`), key rings that move past a refused or busy key at once, one price table (replaces
  wren `core/model-prices.ts` and weaver `prices.ts`; free rings record `usd: 0` with
  `listUsd`), the zod parse with one repair, speech ears (Groq, Cohere, any
  `/audio/transcriptions` server), `commandModel` and `claudeCode`, spec strings. Mistral and
  Cerebras count as paid: no free ring is proven there. Next: move each caller onto it (raven,
  falcon, weaver, then wren's `@wren/llm` as a thin adapter, studio's look and TwelveLabs, the
  voice transcriber, the decide backends, autobrowse's Llm seam), pins bumped in their own
  commits.
- 2026-10-27, late: one repo for the engine, `wrenautomation/engine`: models, raven, falcon and
  weaver as pnpm workspaces, each still its own npm package. Options weighed: (A) a repo per
  package, the shape so far: a models fix costs up to four publishes and a wren bump, which is
  why wren pinned old raven, falcon and weaver; (B) one engine repo; (C) services behind HTTP;
  (D/E) the packages inside wren, published from there. Ranked by: one commit lands everywhere,
  tests block a publish, each package usable alone, migration cost. Pick, B: E removes even the
  wren bump, but wren's CI does not hold on tests during the redesign (WA-917) and every push to
  its main deploys prod. C stays for state shared across processes only (keys, rate limits,
  spend), which the LLM gateway already holds. One version for all four; a `v*` tag publishes
  each with npm trusted publishing. Between them a package pins `workspace:*`, which the pack
  turns into the exact version. No changesets: with one shared version, its notes would be
  ceremony, and the publish needs its own `pnpm pack` + `npm publish` step for trusted
  publishing anyway. History kept by `git subtree`; the four old repos archived with a pointer.
  The direction holds by exports: models depends on nothing of ours, raven on models, falcon on
  models, weaver on all three. Products (config, UI, billing, a client) stay in wren's app layer.
- 2026-10-27, late: Gemini reads a clip of a video (start, end, fps) through the AI SDK's
  `google.interactions` route, store off; every other request stays on generateContent.
  Options: (A) the Interactions route for clipped parts only; (B) generateContent with a fetch
  wrapper that patches `videoMetadata` in; (C) a raw Gemini REST adapter in models; (D) falcon
  keeps its own `askGemini` beside models. Pick, A: framework code only, and live it carried the
  offsets (a 7 s YouTube clip at fps 0.5, low resolution: 365 video tokens against 1676 for the
  whole video on generateContent). Risks: the route is beta; a recitation stop there shows as a
  failed run, so callers branch on `isFiltered`, never on the stop string. Cohere reads images
  only: falcon samples frames for a model whose `takes` lacks video; models never drops a part.
- 2026-10-27, night: the Gemini clip route reversed. Interactions dropped: on free keys its
  flash quota is spent at the first call (429). A clipped video part goes to generateContent,
  and `withClips` sets the `videoMetadata` offsets on the wire (option B above). Verified live
  on 3.5-flash. A file too big to send inline uploads once through `geminiFile` (the Files API),
  pinned to the key that took it.
- 2026-10-27, night: wren's `@wren/llm` onto models. Options: (A) `LlmClient` stays and wraps a
  models `Model` (a thin adapter); (B) every caller takes a `Model` and `LlmClient` goes;
  (C) A now, then B caller by caller. Pick, C: one door for keys, retries and prices now, and
  each caller moves in its own commit. `modelLlm` adapts a `Model` to `LlmClient`; `makeLlm` and `llmForKey` build models' specs;
  `AiSdkLlm`, `RotatingLlm` and `ClaudeCodeLlm` are gone, and one AI SDK is in the bundle. Each
  call keeps three tries (2 s, 4 s), the 2048-token default and a cut answer's text. Still on
  the B list: `studies/plan.ts` (the planner falcon 0.5 dropped, until `wren study` runs on
  raven and weaver), the llm-gateway catalog, decide's backends, TwelveLabs in studio.
  autobrowse's Llm seam stays: it needs none of the new parts (asked 10-27, deferred).
- 2026-10-28: William's canvas notes (project "Birdwatch system"). Birdwatch is the name of the
  whole system; the packages keep theirs. How agentic: (A) typed steps and a runner, today;
  (B) three agents that send English messages to each other; (C) A, plus records as messages:
  each record may carry an English `note`, and any step may write a `gap`; (D) one agent with the
  three parts as tools. Ranked by: no step hidden between two records; runs on the files backend
  without wren; flexible; cost. B fails the first two. Pick, C, as an experiment, run against A
  on one ask; William works through D (Claude Code) above it. The runner still routes and the
  round budget still caps it. Peek: no partial read; full reads stay (the 10-26 rejection
  holds). The check is a sample: falcon takes a sample of a run's findings and checks each one
  against its stored document, never a fetch of the whole source again. Age: the hit and the
  document already carry `date` when the source gives one; a finding takes its document's date,
  and the plan file per ask kind says how much age counts (prices and tools: much; principles:
  little). Never a hard cutoff. Not built yet.
- 2026-10-28, later: C built (WA-921), engine 0.8.0. Weaver: `gap` records (fetch: a query no
  searcher gave a new hit; read: a kept hit no source could open; `weaver gap` for a person),
  a `check` step between extract and review, `check` records, a finding's `date` from its
  document, `weaver back <run> <step> -r` (a person's edge). Raven: plan files version 4 with
  `budget.checks` (3) and an `age` sentence per kind; `Ask.open` (the last review's why on
  again, plus that round's gaps) rendered before "Known"; the review sees dated found lines,
  gaps and checks. Falcon: `checkFinding` (3000 characters each side of the quote). Decision:
  a failed check writes a drop call, so a bad sentence leaves found and known; a person's keep
  reverses it. No `note` on every record: gap, why and steer already carry the English.
  Experiment, same ask as 10-27 (Haiku, searxng + fetcher, 3/6/3), one run each, A = 0.7.1:
  documents 8 → 13, findings 64 → 88, tokens in 87k → 169k, out 29k → 43k, $0.023 → $0.039
  (the check step $0.0034 of it; 9 checks, 1 failed: the quote spoke of programs, the sentence
  of buyers). The main effect: C's plans took the review's why. A's round 3 queries repeat
  round 2's ("benchmark survey 2026", "American Staffing Association", "reddit"), and the why
  it ignored asked for churn reasons; C's rounds 2 and 3 searched what the why named (rehire
  reasons, MSP/VMS supplier criteria, supplier-side retention). A lost 5 opens with no record;
  C wrote 4 read gaps, all on one trade site that blocks the fetcher (the ladder's job). No
  fetch gap: every query found new hits. Search noise makes counts weak; the query shift is the
  signal. Verdicts stay thin in both: the ask. Ledgers: tasks repo `docs/10-28/engine-runs/`.
  Open: gaps of the last round reach no model (the budget stop is fixed), only the person;
  stored plan files on disk keep their old prompts until refreshed (`raven plans <kind>`).

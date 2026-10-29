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
  of buyers). The main effect: C's plans took the review's why. A's queries barely moved
  from round 2 to round 3 ("benchmark survey 2026", "American Staffing Association", "reddit");
  C's rounds 2 and 3 searched what the why named (rehire reasons, MSP/VMS supplier criteria,
  supplier-side retention). A lost 5 opens with no record;
  C wrote 4 read gaps, all on one trade site that blocks the fetcher (the ladder's job). No
  fetch gap: every query found new hits. Search noise makes counts weak; the query shift is the
  signal. Verdicts stay thin in both: the ask. Ledgers: tasks repo `docs/10-28/engine-runs/`.
  Open: gaps of the last round reach no model (the budget stop is fixed), only the person;
  stored plan files on disk keep their old prompts until refreshed (`raven plans <kind>`).
- 2026-10-28, later: engine 0.8.1. After `--pause` the fold's round is one ahead of the last
  review, so `weaver gap` and `weaver back` stamped the wrong round: the next plan missed the
  gap, and back pointed at a round with no plan. `personRound`: between rounds, the round the
  review closed; mid-round, the current one.
- 2026-10-28, later: engine 0.8.2, the gaps after C. The last round of the budget is reviewed on
  the model too (about $0.0005): the edge stays stop, and its why says what the ask still lacks.
  A person's keep or drop with its why reaches the round's review and the next plan; that is the
  "note on any record" idea, with no new record type. A page the ladder could not pass is a miss
  with a gap, like the fetcher's 403; before, it stopped the read step. Stored plan files older
  than the stock already print a warning (`engine-cli.ts`). wren pins 0.8.2 (readers unchanged).
  Open: a terminal run has no ladder with a browser rung. The CLI's `site call web GET /fetch`
  stops at impersonate (403, cloudflare on the trade site of the 10-28 runs); only the desk has
  `render`, and it serves Restate only. Options: a Restate-ingress `LadderClient` in weaver, or
  an HTTP face on the desk. Browser time is William's call.
- 2026-10-28, evening: evaluation against the 10-26 goals, with William. Drift: the runner
  became the main path and every step grew a model call; no human call on a finding in any
  ledger (all calls are triage's); the budget is the stop rule (0.8.2 fixed it harder); no run
  ever wrote a plan file; no wren line on the engine; no synthesis step (patterns across
  sources, the SOP). Rule adopted for this space: a step that decides what comes next or judges
  the whole (plan, triage, stop, patterns, the SOP) is the agent's; a step with a fixed,
  checkable output that runs many times (extract with the quote gate, transcribe, watch) is a
  code → model tool. The engine manages no agent cost: Claude Code, Codex or a custom agent
  slots in, in a chat or headless. Options: (A) engine drives, today; (B) agent only, runner
  deleted; (C) agent drives, the runner stays as a thin second driver over the same step
  functions for experiments; (D) MCP server, against the no-MCP rule and less portable than
  CLI + JSON + a markdown skill. Ranked by: steered by chat; every decision a record with a
  why and the agent's id; any agent can drive; runs alone (headless Claude Code); spend
  visible. Pick, C. Redesign: raven shrinks to types, merge rules and `brief` (its model calls
  serve the runner only); weaver exposes each step as a command (`search`, `open`, `extract`,
  `check`, `add`, `brief`) and the runner loops over them; falcon unchanged plus a `pattern`
  record (sentence, finding ids, source count computed by code); a `birdwatch` skill in the
  engine repo, agent-agnostic; plan files learn at the end of a run that worked (`writePlan`
  gets its caller); the forced stop of 0.8.2 reverts, the budget is a guard rail again; the
  person commands become agent tools, William's involvement is chat. Wren's Postgres ledger and
  the study port move after this, justified by client demand (a self-serve surface), not by
  design. Business: sold by outcome stages (scoping, research, playbook), not by package;
  done-for-you first, standing watches second, self-serve on the API only when asked. First
  real ask: ATS resume optimization, in a parallel session.
  Later that evening, William: sell 1 (done-for-you playbooks) and 5 (a run inside every Wren
  engagement) around 4 (domain packs as the asset, not a product); not 2 (standing watches:
  full automation may not work yet, a person at the seams is what makes it work); 3 (self-serve)
  long term. Target: high-ticket, long-term projects for businesses making the AI jump. The
  engine's license goes from PolyForm Shield to PolyForm Strict with the next release (the
  versions on npm to 0.8.3 stay Shield); a client's use needs a license from Wren, in the deal.
  Built the same night (WA-928, engine 0.9.0, the first release under Strict): weaver's agent
  commands `plan`, `search`, `open`, `extract`, `check`, `add query|finding|call|edge|steer|gap`
  and `brief`, each one step over the same functions the runner loops (`readHits`,
  `extractDocuments`, `checkSample`), the same ledger, so `run --resume` takes over a run an
  agent started and `brief` reads one the runner made. `plan` writes the snapshot (ask, known =
  findings so far, every steer, what the last round left open, allow-list, budget) and no
  queries: the agent's come through `search`, never capped. The budget is a guard rail: `brief`
  shows it, an edge `again` past `budget.rounds` warns. `add finding` runs the quote gate. A
  `--human [name]` record is the person's word through the agent. Every record names the agent
  (`--by` or `WEAVER_AGENT`). Test: a scripted run step by step, then the runner with nothing to
  do. UI, William's question the same night (Colton Dean's social media brain as the reference):
  not now. His view, which is the design's: a person must be able to step in at any step at any
  time, so the chat is the control plane and a UI only shows. The ledger is already that view's
  data (every record typed, with its round, who, why). When the first client is in a deal, a
  read-only run page in the portal (Reports), from the design-language artifact: ask, rounds,
  kept findings with quote and link, what is open, cost. Until then the report built from the
  ledger is what a client reads. Next: the `birdwatch` skill, falcon's `pattern` record, the
  person commands become the agent's, the 0.8.2 forced stop reverts, plan files learn.
- 2026-10-28, night (WA-931, engine 0.11.0): the dogfood on Wren's own asks (one customer
  profile, one channel, one offer) with William at every step. Two changes from it. (1) Raven
  gives the round's search a shape: a query tree. Facets are the sides a researcher covers (the
  plan file's `tree` guide names five: a number, a how, a who, a counter-view, a primary source);
  each facet has tries in order, each try a list of queries. Weaver runs one tier per `search`:
  every first try in one fetch, then, after triage, the next try of each facet still thin (under
  the guide's `thin`, 3 kept hits), until each facet has enough or runs out (0.12.0; 0.11.0
  measured thin on new hits, and with three searchers each returning a page no facet was ever
  thin: the first dogfood run showed it, 6 of 13 queries ran. Yield is what the agent kept; a
  searcher's count is noise. `--all` runs every next try regardless, the agent's escape hatch.
  Rejected: thin relative to the source's page size, a heuristic that moves with each source).
  A page a second query brings back is a `found` record on the
  first hit (a new ledger type, append-only, one row per re-find; chosen over a correction record
  that restates `hit.queries`: smaller rows, one hit row stays one), and the brief ranks hits by
  the facets that found them. A facet whose every try wrote nothing is a gap; a single thin try
  is not. The agent writes the tree, shows it to the person, and `learn --thin|--tree` tunes the
  guide. Flat queries still work. Taken from Perplexity and Gemini Deep Research: a plan the
  person edits before it runs, breadth then depth, follow-ups from what is thin. (2) The headed
  agent reads for itself: `show <run> <document>` prints the stored text, `add finding` writes
  what it read behind the quote gate, `add check` its own check (a fail drops). This overrides
  the 10-28 rule for extract and check on a small run: William's reason is that the agent's
  reading is the better judge and runs on his Claude Code usage, not API spend, and he can
  discuss each finding. The model paths (`extract`, `check`) stay for bulk and the runner; both
  paths write the same records.
- 10-28, evening, engine 0.13.0 (from the first dogfood run's reads). Three defects, three fixes.
  (1) An open source claims the URLs it opens (`opens`): the read step asks before a call, so
  `youtube` writes no spend on a plain page (0.12.0 wrote one `ok: true` per hit per opener).
  A fetched page with nothing usable (a 4xx, a block, a PDF through the ladder, no reader) throws
  instead of returning null: the spend is `ok: false` with the reason, the next opener tries, the
  gap lists every reason. Rejected: a `{doc|miss}` return shape, which would need every caller to
  branch; the runner already turns a throw into an `ok: false` spend. (2) Exa returns one
  three-sentence highlight per result as the snippet, so triage has words; billed per result on
  top of the search. (3) The ladder reaches the desk worker through the Restate ingress
  (`POST /desk/call`, `RESTATE_INGRESS_URL`, `RESTATE_AUTH_TOKEN`), the same door wren's CLI uses;
  the HTTP face it spoke before is not running on the Mac. Rejected: a Reddit reader (old.reddit
  JSON 302s to login, www and api 403, the www HTML is a JS shell) and a browser user agent on the
  fetcher (an identity choice, William's). Reddit goes through the ladder's render tier; the ICF
  PDF stays a gap, with both reasons.

**2026-10-28 night: signed-in reads and captchas.** William: captchas never block, read signed in
with Wren's accounts, the account configurable. Options and the pick in autobrowse
`designs/2026-10-28-signed-in-reads.md`. In short: the render rung solves captchas with the flows'
solver; weaver gets one reader per site over the site's own read route on the desk (a Reddit thread through
`reddit-public` signed out, then signed in only on a miss; Facebook group posts through fb-public,
always signed out); the caller names the account (`WEAVER_ACCOUNTS`, suggested
`reddit=reddit@alt` so reads never risk the posting account);
readers that claim one site go before general openers. Rejected: cookies out to weaver (secrets
leave the vault, ban risk), a signed-in render for now, a Chrome user agent on the fetcher (the
ladder has one). This supersedes the 0.13.0 entry's "Rejected: a Reddit reader". That reader would
have fetched the page; autobrowse's `reddit-public` now reads a thread from its RSS feed when
`.json` is 403, so a reader over the route gets clean text signed out. Shipped in 0.14.0.

### 10-28 night: findings across runs (WA-934), engine 0.15.0

A new run read pages an earlier run had already proved. Options:
A. `weaver recall <terms>`: read every run's findings at plan time, ranked, each with quote, URL,
source date and run. The agent judges what still holds.
B. A shared fact store with a time to live, filled at the gate.
C. Hits only: skip a URL an earlier run opened.
Ranked on: the agent decides (the 10-28 rule), no second store to drift, age shown not guessed.
Picked A. B puts a staleness rule in code that only the agent can judge. C skips pages but keeps
no facts. Recall ranks with MiniSearch (BM25, prefix, light fuzz) over text and quote, not a
custom scorer. Dropped findings stay out. One quote on one page from several runs shows once,
newest, with `alsoIn`. `--also` reads more ledger folders (one per day).
Same release: a quote under 5 words is `quote_short`, no longer `no_quote`. A site-scoped query
skips a searcher that cannot keep the site (`Source.keeps`; YouTube keeps only YouTube).

### 10-28 night: premises and rough drafts, engine 0.16.0

William, from the blind restart: an anchored ask (a named buyer, offer or price) biases the plan.
Known lines with no source were the way in. Now `--known` takes a URL or a ledger id. A line
without one moves to `premises` (also `--premise`). Raven's prompts show premises apart, to
test. The tree gets a `premise` facet that stays uncovered until a query serves it. Code moves
the line; the agent judges what the ask text itself takes as given. Kept findings reach the
next round's known with their URL, so they count as sourced.
William: rough synthesis can be automated; the final write stays his. `add draft` takes items
that cite kept findings or patterns. Falcon's draft gate (`gateDrafts`) drops an item that
cites nothing kept, or has a number no cited quote has. One item per gate call, so the gate's
8-item cap does not apply. A draft record is never the final.
Open, as options to William: a source class with counts per class on patterns (point 2), and a
run tree for the niche, then per niche, loop (point 4). Neither is built until he picks.

### 10-28 night: William picks; source classes, engine 0.17.0

Point 2, site counts are weak evidence. William picked B: a class on the document, which its
findings take; a class on one finding overrides it (a vendor page that quotes a survey). A
(class per finding) was slow and uneven for the agent. C (a model classifies at open) took the
call from the agent and cost a model call per page. The class is a `class` record, latest per
target wins, from a closed set (primary_data, survey, practitioner, vendor, forum, news,
other): counts add up only if every agent spells them the same. Growing the set is additive.
Patterns show distinct sites per class. The runner writes no class.
Point 4, the loop shape. William picked A, a tree of runs, and asked for care with depth. The
back-and-forth he wants (find niches, test each, edit the plan, refine queries, drop dead ends)
is rounds inside a run plus the tree across runs. A child links to its parent; when it stops,
its patterns and dead ends reach the parent's next plan. Caps: depth 2 by default, set in the
plan file; a cap on children per round; a child's budget comes out of the parent's, never
fresh; each child carries a why. `plan --parent` runs recall over the siblings, so a child sees
what they found before it plans. A facet thin after its tries gets a `dead` mark with why, so
later plans skip it. A shared board for raven and weaver (one state, no tree) was rejected: it
loses each child's budget, stop and resume.
Falcon's place: raven decides, weaver does and remembers, falcon reads and checks (bytes to
text, the quote gate, the draft gate). Falcon is called by weaver, never in the loop control.
It stays apart: wren's books, studio and learn use it with no web.
Built as 0.18.0. Settled shapes: the caps live in the plan file (`runs: {depth, children}`,
absent = 2 and 6; `learn` moves them). The parent link is on every snapshot of the child, with
the parent's round at the start. A child's budget is per field the smaller of its plan file's
and its parent's; past the tree's reads, a warning, not a stop. Dead ends reach the parent as
known lines ("dead end, skip it"), not open ones: raven reads open as "pursue". The agent's plan
and the runner's share one `planAsk`, so a runner-driven parent reads its children too.

### 10-28 late: failed checks, forum threads, vendor echo, engine 0.19.0

The first blind niche round: 1460 model checks, 269 failed (18%), all on Haiku's findings; the
agent's own 15 findings failed none. So the extract, not the checker, was the lever. The fails
fell in five kinds: one voice written as many ("owners say"), a hedge dropped ("probably" to
"most"), advice or a pitch written as a report, a speaker's role the page never gave, and a
sentence with more than its quote. Each is now a rule in falcon's extract prompt. Trial, same 20
pages, same checker: 14.5% to 1.6%, $0.08.
William's picks on the runs session's points: forum pages count per thread (each document), not
per site, so 31 threads are 31 sources. Vendor echo is a warning and an `echo` flag, not a
block: vendors can agree for real; the agent finds the source they cite or calls it a claim.
Checks: William has $200 a month of Claude API credits; spend them on quality. The check reads
the budget's `checks` or a tenth of the kept findings, whichever is more, and `check
--patterns` reads every finding a pattern rests on (patterns come after the check step, so a
default sample cannot cover them). Brief recounts a pattern's sources over kept findings: the
stored count goes stale when a check drops one. Verdicts per facet: wait.
From the runs session: a facet names the classes that can prove it (`needs`); brief flags
`lacks` when its read pages have none, and a facet whose every try pins one site is flagged.
`enough` still counts kept hits at triage: counting per class would need a class before the read
(a host guess or Jev), which changes the loop. Open for William.
Open: Jev (TypeSafe, labels and probabilities, no text, $0.042 per 1M input) for yes/no,
choice and rank steps: first pass of the check, a triage sort, a class guess. Not built until
William picks. A check fail drops the finding; most fails are overstated, not false: a repair
step (narrow the sentence to the quote, gate again) is his call.

### 10-28 evening: Jev as a hint and a router, a check's fix, engine 0.20.0

William: "Cheap models making decisions is a nono", but use Jev heavily for yes or no, picks and
ranks. Options for its role: (a) a decider on cheap steps (triage, class, check pass), (b) a
shadow that logs answers next to the agent's for a later switch, (c) a hint and a router that
never writes a call or a check. Ranked by: no cheap final call, then coverage, then cost. (a)
breaks the first rule. (b) pays for answers nobody uses. Picked (c).
The judge lives in `@wrenautomation/models/judge` (William: one door for every model call):
`Judge`, `jevJudge` on TypeSafe's SDK 0.6.0 (pinned like wren), `fakeJudge`, `judgeFromSpec`;
a row in the price table, input only. weaver asks it of each new hit (serves the ask, whose
side, class), each page (class) and each kept finding with a quote (backs the sentence,
credits another source); each answer a `judge` record, each call a spend. Uses: the brief sorts
uncalled hits by facets then serves and shows the answers; `documents.unclassed[].guess`; a
facet with `needs` counts the guessed class before a read, so `enough` waits while every kept
hit is the wrong class (no class known: the old rule); `patterns[].cites` and the vendor echo
warning name findings that credit a source. The check reads its sample plus every finding the
judge backs under 0.8; a judge's yes never shortens the sample. `accept` writes calls or classes
in bulk at the agent's own bar, the judge's number in each why: the agent decides, the record
is the agent's. `brief.judge` counts calls, cost and agreement with the agent and the check,
which is the trial data a shadow would have given. The key is `TYPESAFE_API_KEY`; it is in
prod's env only, so no live run yet.
Repair (William's yes): a check that says no can give a fix, a narrower sentence the same quote
backs. weaver gates it like any finding, checks it again with Claude, and writes it as a new
finding with `fixes` naming the old one. Still open: a live Jev trial on a runs-session ledger
(agreement per question), then the DOUBT bar.

### 10-28 evening: the tree's reads cap, depth a guard rail, engine 0.21.0

The first judged run (birdwatch runs, 178 Jev calls, $0.0088): hits agree 48 of 71; class
guesses 13 of 15 (8 of 8 at 0.8 or more, 2 of 7 under it); checks doubted 49 of 49, 6 failed,
4 repaired. `backs` against the check: AUC 0.71, but one fail sat at 0.71, so no bar that
skips checks is safe. Kept: DOUBT 0.8, every doubted finding checked. `serves` against the
agent's keep: AUC 0.75, and it ranks vendor pages high on a buyer survey: the skill now says no
high keep bar. A facet whose read pages lack its `needs` is no longer `enough`.
Depth: the runs session hit the depth cap (2) at once and made a sibling to get round it. The
2 was a guess. Options: (a) keep 2 hard, (b) raise it, (c) a guard rail only, (d) a guard rail
plus one hard cap on the whole tree's reads, with the lineage in the brief. Ranked by: cost
stays bounded, then the agent's reach, then few knobs. (a) makes workarounds; (b) moves the
guess; (c) leaves cost open. Picked (d), William's yes. `runs.depth` warns and asks the why to
say why deeper beats a sibling; the children per round still stop; `runs.reads` (or the root's
reads × rounds × (children + 1)) pins as `treeReads` on the root's snapshot, and `open` stops
or cuts its hits there. `brief.lineage` and `brief.treeRoom`. A facet retried needs no child:
a try in `tree.json` or the next round.

### 10-28 evening: a UI for runs, one read seam

William wants a view of runs for a demo video and for people who check: the full tree, the back
and forth, every source (at least its link), posts and videos where they live. Fact that
decides it: the ledger is JSONL on this Mac, written live by the CLI; the portal deploys to
Cloudflare. Options: (1) a portal module over a ledger synced to prod, (2) a viewer inside the
engine (`weaver view`), (3) one UI in the portal over one read seam, (4) Evidence or Observable
Framework over DuckDB. Ranked by: checking accuracy (the quote beside the live source), demo
quality (live, motion, the artifact bar), one source of truth, least plumbing. (1) has no live
view; (2) is a second UI codebase and puts the design language in a public repo; (4) misses the
artifact bar and reels. Picked (3), William's yes: weaver gains `serve` (JSON and a live stream
over any ledger); the portal module reads it on this Mac now and a synced ledger later through
the same seam. The seam carries its own JSON shape, so the portal imports no weaver (wren pins
0.8.2). v1 is read only: the CLI stays the one writer. Google results render as our own list
of hits; posts and videos use each platform's embed beside the ledger's stored copy.

### 10-28 evening: follow, people, Google, a worth trial, engine 0.22.0

William: search like a person. After a good video, look through the channel and for videos like
it; good posts cluster in people; a good author's blog, Substack and X are worth a look; Google
with its AI Overview. Options for the follow: (a) the agent searches by hand, (b) a follow
query routed to sources that can list a page's neighbours, (c) an automatic expansion of every
kept page. Ranked by: the agent decides, then cost stays bounded, then one path for hits.
(a) loses the edge from the page to its neighbours; (c) decides for the agent and spends on
every page. Picked (b), William's yes: `weaver follow --as posts|similar` writes a query with
`follow: {url, as, document?}`; the fetch step sends it to sources with `follows`; up to 30
hits go through triage, reads and the tree cap like a search's. posts: yt-dlp (a channel's
uploads from a video or the channel, a TikTok profile), reddit (a user's top posts and
comments, one of the 240 reads a day). similar: Exa findSimilar off the page's own site.
A `person` record (profiles, names) ties one author across sites; the brief counts kept
findings per person and lists kept pages no follow and no person covers. Finding a person's
other profiles stays the agent's job (search, read, `add person`): a fixed tool would guess.
Google: `web GET /google` on the desk; each result a hit; the AI Overview one hit, a claim,
never a proof, and each page it cites a hit. Instagram reels need a login in yt-dlp: skipped.
Bug found by the test: a source let in by `--with` ran every earlier query. A query now runs
only on the allow-list as it stood when it was written.
Jev: William trusts the call. Jev takes sorting and routing, never a final call. A trial: Jev
answers a page's `worth` (would a careful researcher cite it for the ask) when it is read.
`brief.judge.worth` gives its AUC against "a finding on it was kept" and what a gate at a half
would skip. Nothing gates on it. If the AUC holds high over several runs, it can order the
extract; if not, it stays a hint.

### 10-28 evening: weaver serve and the Research page, engine 0.23.0 (WA-938)

What shipped: `weaver serve` (Hono on 127.0.0.1:4747) gives `/runs`, `/runs/:run` (RunView v1),
`/runs/:run/documents/:doc` and `/events`. The portal's Research module (team only, read only)
shows the runs, and per run three tabs: the tree (the @wren/ui Graph), the back and forth
(every decision with its why and who) and the sources (each hit with its link).
Decisions, ranked by live demo, checking accuracy, then least plumbing:
- Live stream: SSE over WebSocket and over polling. One way is enough (the CLI is the one
  writer); EventSource reconnects by itself. Polling costs a full view (3.1 MB on the big run).
  serve watches runs/ (recursive `fs.watch`, 150 ms debounce) and drops a run's cached view.
- Drawing: the kit's Graph (React Flow, elk) with two zooms, not a new canvas. Pages read is
  the default; Every hit draws all of them (807 on the big run: elk takes seconds). Hits fold
  into each query's numbers. A follow hangs off the page it started from.
- Reach: the browser fetches 127.0.0.1 straight, not through a tunnel or a relay. Chrome's
  Local Network Access asks once (tested: refused without the grant, read with it); CSP
  connect-src names the port. Limit: v1 works only on this Mac, not on the iPad. A synced
  ledger later uses the same seam.
- Shape: serve sends a UI-shaped RunView, versioned (`v: 1`); the portal copies its types and
  refuses another `v`. The portal imports no weaver. Gap: `brief` is still the agent's shape;
  a later weaver flattens what the page reads (people) into the view.
- Design: the design language has no research section. The page composes Graph, RowsPanel,
  Seg and the Learn player's embeds (moved to `src/embeds.ts`). Reddit, Facebook and Google
  hits stay links: frame-src has no Reddit, and Google gives no embed.

### 10-28 night: arXiv, Jev reads pages whole, criteria, engine 0.25.0 (WA-950)

What shipped: an `arxiv` source (search and read), `--criterion name="question"` on `run` and
`plan`, and a judge that reads a page whole. Public benchmarks are parked (William: overkill now).
Decisions, ranked by signal per dollar, then least plumbing:
- Jev reads the whole page, not the first 4,000 characters. Jev input is $0.042/M, about 24x under
  Haiku. Its cap, probed: 30k tokens pass, about 43k gives a 400 (no silent cut). So parts of
  64,000 characters, 4 at most, each answer the most yes of any part. The body ends at the last
  References heading; an appendix stays (ablations live there). A paper costs about $0.0005.
- Criteria: one question per test, all in one call, on every hit and every page. Their mean sorts
  `hits.uncalled` and `documents.toExtract`. A sort and a hint, never a gate (Jev rule).
- Not a hard Jev filter on arXiv, as first asked. Today's data does not earn it (the 0.22.0
  `worth` AUC was 0.60 on 16 pages). Fixed filters (categories) cut first, Jev ranks, the reads cap
  cuts, Claude makes every drop.
- arXiv through export.arxiv.org, the host arXiv names for programs: one call at a time, 3 s apart.
  HTML first (tables, sections), the PDF when it has none. Every-word search, topped up with
  any-word results when short.
- Citations from OpenAlex, not Semantic Scholar: S2's keyless pool gave 429. OpenAlex is keyless on a
  shared daily budget; `OPENALEX_API_KEY` (free) gives its own. A merged work can carry the
  published DOI, so an id matches anywhere in the row. Counts run low (ReAct: 603).
- arXiv stays out of the stock web plan file: most asks are not papers. `--sources arxiv` names it.
- A second label for the judge's AUCs: the extract's verdict "rich". Papers nearly all yield a
  kept finding, so "a finding was kept" had no negatives.
Dogfood (one runner run, cs.AI/CL/MA/IR, 5 criteria, $0.13, 13 papers read, 1 rich). Thin data,
one positive; read as direction only:
- On the page, `worth` AUC 1.0, `ablation` 0.92, `gain` 0.88. On the hit (abstract): 0.50, 0.42.
  Abstracts rarely state ablations or code; full text does.
- `research_task` on the hit caught both off-topic reads Haiku's triage picked (0.08, 0.12).
  The one criterion that would have routed them away.
- `gain` sat near 0.95 on 12 of 13 pages: nearly every paper claims a gain, so it sorts little.
  A criterion most sources pass is a weak router.
- `code` ranked badly (0.25): release of code does not predict a rich page for this ask.
Not done: the 30-paper side by side of full-text Jev, abstract Jev and Claude. More runs first.
Follow-up, engine 0.26.0: the runner's triage saw neither the criteria nor Jev's answers (the
agent path sorts by them in `brief`; the runner did not). Now every prompt shows the person's
tests in the steer slot (no plan file version bump: stored files take it), and each triage hit
carries Jev's yes odds (serves, each test) marked as a hint. Haiku still makes the call. One
paused round on the same ask: reads under 0.3 on `research_task` went from 2 of 6 to 0 of 6;
rich reads from 1 to 2. Direction only.

### 10-28 night: refs and citers, a decider model, Jev against Sonnet, engine 0.27.0
- The extractor reads the body: `bodyOf` moves to falcon/document, and the reference list is cut
  before parts split. It holds no finding and cost Haiku tokens on every paper.
- Each review sees every earlier round's new hits and kept findings ("Hits 9 new (earlier
  rounds: 40, 15)"). It rides the `{hits}` and `{kept}` slots, so stored plan files show it. No
  stop rule in code: stopping is the review's call (the 10-28 rule).
- `follow --as refs|citers` on an arXiv paper. Options weighed for the reference list:
  OpenAlex (none: `referenced_works` is empty for arXiv works, 4 of 4 probed), Semantic Scholar
  (has them, plus an influence flag), parse the paper's own bibliography (no API, but brittle).
  Chose Semantic Scholar for refs, OpenAlex for citers (one call, sorted by citations
  server side). Refs order: the works the paper leans on (influence flag) first, then by
  citations; by citations alone, background classics (GPT-3) led. A hit is the arXiv page when
  there is one, else the DOI. A refused call throws, so a spent keyless budget is a gap.
- `--decider` (`WEAVER_DECIDER`): plan, triage and review on their own model; extract and check
  stay on `--model`. Default Sonnet when the model is Haiku: decisions cost cents a run, and the
  rule is Haiku restates, Sonnet decides. A stronger `--model` is never downgraded.
- Dropped: routing more checks on Jev's doubt. The doubt pass already adds checks, never fewer.
- The side by side, 25 arXiv papers (12 picked at random from run 1's unread hits), Sonnet
  reading each body as the reference ($1.27). AUC of Jev's yes odds against Sonnet's yes:

  | test | yes | Jev on page | Jev on abstract |
  |---|---|---|---|
  | research_task | 14/25 | 1.00 | 1.00 |
  | ablation | 11/25 | 0.98 | 0.84 |
  | code | 19/25 | 1.00 | 0.77 |
  | no_training | 18/25 | 0.94 | 0.81 |
  | gain | 21/25 | 0.99 | 0.96 |
  | serves (page: worth) | 11/25 | 0.89 | 0.72 |

  Jev on a whole page is near Sonnet on fact tests, at about 1/50 the price. The abstract is
  enough for topic (research_task) but not for ablation or code. Judgment (worth, serves) is
  weaker, 0.89 and 0.72. So the 0.25.0 "code AUC 0.25" was not a Jev miss: code was read right
  and does not predict a rich page. Jev stays a hint and a router; its fact answers on full text
  are good enough to sort by.

### 10-28 late: openers never search, call flips, engine 0.27.1

The runs session saw arxiv add about 35 off-topic hits to an accounting ask. Cause: the CLI's
allow-list let in every source that opens, and arxiv also searches. youtube did the same on
web runs.

Options weighed:
- Let in only openers that do not search. Simple, but a web run then cannot read an arxiv or
  YouTube page well without `open --with`.
- Turn arxiv off unless the ask names papers. A code rule on the ask; the agent should decide.
- Split the list (taken). The snapshot keeps `sources` (search, open, follow) and adds
  `opens` (open and follow only). The other openers join `opens` unless `--sources` was given.
  `open --with` and `follow --with` join `opens`. Older runs keep their lists.

Call flips: the last call still wins. A flip now warns with who, round and why. An agent call
that flips a person's call fails: a person outranks the agent.

### 10-29: access codes, engine 0.28.0

From the Agent-Reach review (WA-958). A failed site read carries one of `need_login`,
`platform_blocked`, `rate_limited`, `upstream_broken`. autobrowse detects them and owns the list;
weaver reads them and decides. The reddit reader no longer reads signed in on a spent cap or a
broken site. Options and the Restate transport choice: autobrowse
`designs/2026-10-28-signed-in-reads.md`, "Access codes".

Same day: wren's `SiteCallError` carries the code (HTTP `code`, Restate `metadata.code`; a live
probe on the desk confirmed the ingress keeps it). Analytics: `need_login` is a `needs_william`
gap, `platform_blocked` an `error`. Reddit's signed-out `/api/me` is `need_login` now, not a wait.

### 10-29: three packages, birdwatch is the product, engine 0.29.0 (WA-970)

William: birdwatch is the process, so the bird names under it cost more than they say. wren
imports only the read half (`weaver/fetch` 60 lines, `falcon/text` 13, `falcon/study` 9,
`falcon/video` 9, `weaver/video` 6); nothing of the engine, the ledger or raven. The old seam
(falcon reads bytes, weaver reads a URL) split one job across two packages.

Options weighed:
- Keep models, raven, falcon, weaver. Raven has one user (weaver); the read layer spans two.
- One `birdwatch` package with subpaths. One name, but books and learn install the research
  engine to read a PDF, and the read layer never using the runner holds by lint only.
- Four: models, read, weaver (one run), birdwatch (across runs). weaver would have one user,
  the same smell as raven. Split it out when a second user comes.
- Three (taken): `models` (every model call), `read` (the web and files in: fetch ladder,
  robots, HTML and PDF to text, video over a URL or a file, the study core), `birdwatch`
  (everything else: `./plan` from raven, `./document` from falcon, `./engine`, `./ledger`,
  `./sources`, one CLI). Ranked: each user pulls only what it uses, then the package graph
  holds the direction (read never imports birdwatch), then fewer names.

Moves, no behavior change:
- `read`: no bin (`read` is a shell builtin). falcon's file-only `watch` is `watchFile`;
  `watch` (a URL or a file) keeps its name.
- `birdwatch` bin: every engine command, plus `fetch`, `read`, `list` (was weaver), `text`,
  `page`, `watch` (was falcon) and `plans` (was raven). raven's `plan`, `triage` and `review`
  commands go: `birdwatch plan` and the agent cover them.
- `WEAVER_*` env is `BIRDWATCH_*`; `RAVEN_MODEL` goes with raven's CLI. Stock plan-file ids
  `raven/<kind>` are `birdwatch/<kind>` (a tuned file matches by kind; old ledgers keep their
  ids). The User-Agent is `wrenautomation/0.1 (<contact>)`.
- npm: `@wrenautomation/{raven,falcon,weaver}` stop at 0.28.0 and get deprecated with a pointer.

Follow-ups, not in this pass:
- raven's code planner under the 10-28 rule: the agent plans; what of `./plan` stays is types
  and plan files.
- The across-runs store William named: saved plans, patterns, verdicts and SOPs as linked,
  versioned records, two-way, a change upstream marks what rests on it stale.

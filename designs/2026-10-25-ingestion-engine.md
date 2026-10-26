# Ingestion engine: outside content mapped onto our business (2026-10-25)

William: one general system that reads the outside world (competitors, the open web, pain
points, leads) and maps what is useful onto the business. The machine finds, reads, pulls the
basics, writes the SOPs and uses them. He only decides: keep, change, drop or tune, with his
words. No score. His taste is the judge.

It replaces the competitor analyzer's own loop (`2026-10-25-competitor-analyzer.md`), `wren
study`, and the one-off scrapers each channel would otherwise grow.

## Answer first

- Every use is a **line on the metro map**: find → read → extract → his call → output →
  measure. The map lowers to the **NFA graph**; the **executor** (was "spine") runs each move.
  No second engine, no new hardcoded workflow.
- The NFA grows one thing: **typed workflow instances**. An instance is one subject on one
  line. Its subject is a person (today) or a document. Journeys rename to instances.
- Why documents need instances: his call and the measure are waits of days. State that lives
  across a wait is an instance. A status column plus a pipeline would be a new hardcoded
  workflow. The competitor cannot be the subject: his calls are per film.
- Edges move one instance between states. No edge changes the subject. A line about people
  makes the person the subject from the start; the post is evidence on them.
- Aggregate outputs (a standard, a report) are **readers over a line**: they read every
  instance that sits at "kept". They are not states. Per-person outputs never send without
  his yes (To approve).
- Every fact the machine pulls is a **finding with proof**. His call points at the finding.
- The old hardcoded workflows (keep_warm, close, speed_to_lead, reach.comments, the cadences)
  port to lines **last**.

## Layers

| Layer | Is | Code |
|---|---|---|
| Metro map | the view he draws: lines, stations, tracks | metro body (`packages/pipeline`) |
| NFA graph | what runs: nodes, edges, an instance's state, forward skips | `runOf`, instances (were journeys), `pathOf` |
| Executor | runs each move: one event per arrival, retries, timed waits, on Restate | `packages/core/src/executor.ts`, table `events` (already keyed by a generic `subject`) |

Nothing lives in the executor but plumbing. A workflow is a line.

## The lines

| Line | Subject | Find | Read | Extract | Output |
|---|---|---|---|---|---|
| Video watch | document | the URLs he gives | watch | the basics | stops, for him to discuss |
| Competitor analysis | document | hunt the best sources | watch, read | the kind's rubric | SOP standard and rules (reader) |
| Study | document (page) | web search, Perplexity | read | claims with quotes | report and drafts (reader) |
| Pain points | person | IG and LinkedIn searches; the author enters at a `sourced` source | read the post | the pain, with its quote | outreach on the same instance (per person) |
| Outreach | person | lead lists | enrichment | fit, pain | messages that escalate (per person) |

Stations are shared parts: video watch's read and extract are the same stations the
competitor line uses, with find on top. Pain points is the outreach shape with a different
source; it needs no new NFA part.

## Nouns

| Noun | Is | Store |
|---|---|---|
| instance | one subject on one line: state, trail, status, version | `journeys` renames to `instances`; `subject_kind` (`person`, `document`) with `profile_id` or `document_id`; one open journey per person, one open instance per document on each line |
| document | one read of one URL: text, `kind` (`webpage`, `video`, `post`, `audio`, …), who it is about | research `documents`; `learn.items.document_id` points at it, and the item keeps feed state and its read (transcript, duration, stats) for now |
| finding | one answer to one question about one document, with proof and `by` (`model`, `code`, `hand`) | research `findings`, kind `fact`, gains `question`, `proof`, `by` |
| proof | `{quote}` on a page, `{t, len}` in a video, `{frame}`, or `{method}` for code | in the finding |
| call | his keep, tune or drop with words, on a finding or a document | `decision_calls`, decide kinds `finding` (was `learn_fact`) and `document` (was `learn_worth`) |

Rules:

- A model finding whose proof is not on the document drops (the study's rule, now on all).
- Documents are shared; findings and calls belong to a line. One film feeds two SOPs.
- The subject of a content line is the document, not each finding. He calls one film's
  findings on one screen; the instance moves on when each has a call. Per-finding instances
  would need a split, and splits wait for tokens.
- Readers that mean people filter `subject_kind = 'person'`.
- A live thread is who the document is about; each new message is a new document.
- A finding that answers no question is allowed only on a kept document (cost).

## Stations

| Station | Does | Settings | Today |
|---|---|---|---|
| find | opens instances at the line's source | sources (hunt topics, `ytsearch`, Exa, Perplexity, Ad Library, followed creators, saved links, IG or LinkedIn search, a URL list), cap per run | `sop hunt`, the study plan, `pullCreators` |
| read | candidate → document | reader by medium: page (fetch ladder), video (video-watch on the Mac), post (site API) | `readQueued`, `watch` |
| extract | document → findings | questions: the kind's rubric plus the line's own; before or after the keep | `breakdownItem`, study claims |
| call | waits for his call, or applies a rule | mode `every` (his only; To call queue) or `rule` (decide gate after it matches him) | `recordCall`, `lead_fit` |
| measure | our result per line: our piece's numbers, a reply, a booked call | the measure | `learn back` |

Readers over a line (not stations; the map shows each beside "kept"):

| Reader | Reads | Writes | Today |
|---|---|---|---|
| standard | kept findings of the line | `standard.md`, `calls.md` for the SOP | `sop sync` |
| synthesis | kept claims of the line | report and drafts for the question | study report, drafts |

What the kind decides: the reader, the default questions, the closed sets the standard
counts, the proof type. What the line decides: sources, caps, its own questions, call mode,
output, measure, where it stops. To add a kind (ad, landing page, offer, cold email, article,
episode): one question set and one find source; a reader only for a new medium.

Logged-in finds and reads (IG, LinkedIn, X) use the reach engine's shared reads
(`2026-10-25-reach-engine.md`). A line never polls a platform on its own clock.

## Edge cases

| Case | Answer |
|---|---|
| One person on two lines | one open journey per person; the second entry waits; reach-pass blocks for good |
| One post names a second person (a commenter) | that person enters at the source as a new instance; no edge changes a subject |
| Our own piece | `owner = ours`; never in a competitor standard; measured by learn back |
| A competitor who is also a lead | the person is the subject; the line decides the act, not the owner tag |
| Cost | caps on find; few cheap questions before the keep, the rest after; USD per day per line |
| Logged-in reader | the line names the account and its cap; personal accounts stay research reads |
| 500 leads | call mode `rule`; `every` is for pieces he studies; no sample mode now |
| Re-extract | his calls point at finding rows, so nothing is orphaned |
| Client workspaces | lines live on their own map; only Wren's SOPs export to `sops/` |

## Phases

0. **Rename spine to executor.** Done 2026-10-25. Code, Restate services `Executor` and
   `ExecutorClock`, the phone Worker's `Executor/hook`, views `executor_events` and `executions`
   (migration 0341), map cards. Dated design docs keep their words.
1. **Typed instances and the competitor line.** Journeys rename to instances with
   `subject_kind` and `subject_id`; documents and findings as above; his calls remap from jsonb
   paths to finding ids; the find, read, extract and call stations; the standard reader; the
   launch-films line on Wren's map. Builds 1 to 10 of the analyzer port onto it; nothing he
   called is lost. Video watch alone is the same line stopped after extract.
2. **Study line.** The synthesis reader; claims callable as findings; `study_steps` keeps only
   the find checkpoint.
3. **Pain points.** A `sourced` source fed by IG and LinkedIn searches on the outreach shape;
   the post's pain as a finding on the person; outreach behind To approve; measure per line.
4. **Port the old hardcoded workflows** to lines, last.

## Out

- Tokens (one instance in two places): wait for the first split a client needs (10-23 doc).
- Transfers between lines: no edge changes a subject; a new subject enters at a source.
- A sample call mode. New readers (PDF). Shot labels (proof failed).

## Decision log

- 2026-10-25: William: one general system on the newest stack (metro map → NFA → executor), no
  drift. Aggregate vs per-person outputs; findings with proof; one document store; decide
  modes for his calls. Old hardcoded workflows port last. Rename spine to executor.
- 2026-10-25: phase 0 built. No clock or pending wait existed on main or any client database, so
  no alias was served; the phone Worker deploys in the same run. `Spine` and `SpineClock` stay on
  their last Restate deployment, as `Evolution` and `DealsConsole` do. One kept deployment each; no
  retired service has been removed from Restate yet.
- 2026-10-25: William: the NFA grows only typed instances ("workflow instance", not "rider").
  Journeys rename to instances; subject is a person or a document. Many-rider stations and
  transfers dropped: aggregates are readers over a line, and a line about people makes the
  person the subject from the start.
- 2026-10-25: phase 1 commit 1 (map and lowering, no DB change). A content line is the metro tier
  `content`: it holds only the stations `find`, `read`, `extract`, `call`, `measure`, has one find
  that names an SOP, never meets the hub, and no track joins it to a people station. `graphOf`
  lowers find to a source with via `found` and each other station to a `job` node, whose advance
  is the end of the job before it. Two triggers: `trigger.found {sop}` opens an instance and
  `trigger.station {station}` says a job ended. The event kind is `doc`, not `document`: that
  word already means a contract sent to sign. Back tracks on a content line wait.
- 2026-10-25: phase 1 commit 2 (instances). `pipeline.journeys` renames to `pipeline.instances`,
  with its constraints and indexes. `subject_kind` (`person`, `document`) and a check hold one id
  per row: `profile_id` (now nullable) or `document_id`. `document_id` points at research
  `documents` (the crawl store, the one document store), not at `learn.items`: commit 3 links each
  Learn item to a documents row. Open rules: one open journey per person; one open instance per
  document on each line (`document_id`, `entry`). Readers that count people filter `isPerson`.
  Stored names stay: the `pipeline.journeys` settings key, touch source `journeys`, event subject
  `journey:<id>`, events `journey.move` and `journey.stage`. The lake finds tables live, so it
  starts a new `instances` table; its old `journeys` table stops at the rename. Content lines
  save and lower but do not deploy until commit 4.
- 2026-10-25: phase 1 commit 3a (documents and findings, no behavior change). `learn.items` gains
  `document_id`; `documentOf` makes the row from what the feed gave the first time it is asked
  (url plus a hash of the feed text; kind by medium: reel, film, video to `video`, post to `post`,
  episode to `audio`, article to `webpage`). The read stays on the item: about 350 references read
  it there, so a move now costs more than it gives; a document reader joins the item. `owner` and
  `line` wait until a line other than Learn's needs them. Findings gain kind `fact`, `question`,
  `proof` and `by`; a fact has no person or firm, only a document, and every lead reader filters
  by person or firm, so none sees one. Each breakdown writes its facts as findings keyed
  `doc:<document>/<path>`; `wren learn findings` writes the ones made before.
- 2026-10-25: phase 1 commit 3b (his calls on documents and findings). Every item now has its
  document: the migration backfills them, and the insert trigger `learn.items_document` makes one
  for each new item, so no writer changes and `document_id` is not null. `documentOf` is gone.
  Decide kind `learn_worth` is now `document` and `learn_fact` is now `finding`. A whole-piece
  call's subject is `doc:<document>`; a fact call's subject is its finding's own key,
  `doc:<document>/<path>`, so no join finds it. Labels on `document` are keep, tune, drop; the
  machine is asked keep or drop only (old worth to keep, skip to drop, in rows and answers). A
  star, a pin, a save or an SOP add is a keep on the document, so the standard counts a starred
  piece; the "To call" queue still counts only console and CLI calls. Two items with one url and
  one feed text share a document and so share his calls.
- 2026-10-25: phase 1 commit 4 (content lines run). `lowerable` no longer refuses a content line;
  back tracks on one still wait. The worker's `LineFeed/all` loop runs `linePass`
  (`packages/pipeline/src/lines.ts`) every 5 min, 5 s while a find has more. A find takes Wren
  items tagged with its SOP (`item_tags`) or asked into it (`sop_sources`). It tells a document
  once: never when an instance for that SOP exists (any status, so a renamed find cannot take it
  again), never when this version already has an arrival for `doc:<id>` at the find's targets
  (so a refused move is not told again). A job ends when its row is there: read when a Wren item
  on the document is read (a read failure stays at read), extract when the document has a fact
  finding, call when he calls the whole document from the console or CLI (a mark is no call, as
  in the "To call" queue; fact calls tune the standard only), measure never yet. A job whose row
  came first ends on arrival: a film he read, broke down and called before flows found → done in
  three passes, which is the backfill. `journey.move` on a document node opens or moves the document's instance on that
  version (lock `document:<id>`); `opensAt` matches a found source on its SOP. An instance does
  not close when it arrives at the last station: the pass closes it when that station's job
  ends, with no executor event. `journey.stage` does nothing for a document. The `executions`
  view names a document by its title, else its url. Wren's workspace only. Out: a manual move or
  drop of a document instance (those ports take a person), measure, back tracks.
- 2026-10-25: phase 1 commit 5 (the standard reader; my call, as William left it). Once an SOP's
  content line has taken a document, `standard.md` counts only the line's documents (still only
  pieces `learn.standards` lets count, and in scope), and `calls.md` reads his calls on every
  line document, a dropped one too. Before that, both read the scope as before. The SOP name
  rides on the scope (`SopScope.sop`): `scopeOf(notes, sop)`, and `draftScope` takes the stored
  playbook, so a stored playbook needs no new field. The shape file now takes `sop` on a station
  (commit 1 left it off). `wren learn tag <ids...> --add|--remove` writes the tags a find reads.
  Wren's map v6 has the launch-films line; the 15 seed films are tagged. The backfill ran on
  prod: 25 found, 23 at call (none called yet), 2 hunt finds unread at read.
- 2026-10-26: phase 2 (the study line; my calls, as William left it). Claims are per page, not per
  angle: one model call reads a page's best passages for every angle (`pageEvidence`, 12k chars)
  and each claim names its angle; `CLAIMS_PER_PAGE` 8. Each kept claim is a `fact` finding on the
  page, keyed `doc:<document>/study:<slug>/<sha256(quote)[0:12]>` (`claimKey`), `via` `study`,
  `question` `angle/<i>`, `proof` `{quote}`, so the same quote read again is the same finding and
  his call (`decision_calls` kind `finding`, subject the key) holds through a redo; a redo deletes
  only the study's uncalled claims. `study_steps` keeps the find checkpoint (plan, search, ask,
  read), a per-page `claims` marker (key the page url, detail `{kept, dropped, envelope}`) and the
  `draft` units, whose detail carries `basis`, a hash of the non-dropped claims' numbers and keys:
  a run redraws a draft whose basis changed and the report marks it stale. Not new tables: a
  claim is a finding and a draft is a derived text; neither needs a home of its own, and the
  study's checkpoint table already keys one row per unit. The report numbers every claim, a
  dropped one too (struck, with his words), so `wren study call <slug> keep|tune|drop <n...>
  [--why]` can name them by number; tune needs his words. Drafts read the claims he did not drop.
  On the map a find station names `study: <slug>` instead of `sop` (one or the other, `metro.ts`
  and `checkEntry`); `trigger.found` carries `{study}`; `linePass` takes the study's read pages as
  its finds (they arrive with read ended) and judges each job per line, keyed by `entry_ref`:
  extract ends with the page's final `claims` step, call when every claim on the page has his call
  or he called the page. An SOP line's extract now ends only on a breakdown finding (key not
  `doc:%/study:%`), not on any fact. Out: the synthesis reader as a station (the report is read on
  demand; a reader row would store nothing new), the portal's call screen for claims (the CLI and
  the item page's finding calls are enough while only William calls).
- 2026-10-26: the first prod shape with a study line (v7) opened no instance: the executor's logic
  check still required an SOP name on every `trigger.found`, so it left the whole workflow out
  (`shape.v7 left out` in the worker log). The check now takes an SOP name or a study slug, one of
  them (`logicProblems`). Lesson: a station field that changes a trigger's shape needs the trigger's
  check in `logic.ts` too, and a `soundShapes` test on the metro fixture, not only `metroOf`.
- 2026-10-25: commit 3a's FK (`learn.items.document_id` → `documents`) reached every client
  database, so `truncate documents cascade` (the demo reset) failed on `learn.items` for the
  client login. `learn` joins `CLIENT_SCHEMAS`: a client's own Learn rows, none yet. It also ends
  the older "permission denied for schema learn" when a client's planner reads `learn.standards`.

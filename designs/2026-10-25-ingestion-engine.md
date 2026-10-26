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
| instance | one subject on one line: state, trail, status, version | `journeys` renames to `instances`; `profile_id` gives way to `subject_kind` (`person`, `document`) and `subject_id`; one open instance per subject |
| document | one read of one URL: text, transcript, file, duration, stats, `kind`, `owner` (`ours`, `competitor`, `neutral`), who it is about | research `documents`, gains Learn's read columns; `learn.items` keeps feed state and points at it |
| finding | one answer to one question about one document, with proof and `by` (`model`, `code`, `hand`), on one line | research `findings`, gains `line`, `question`, `proof`, `by` |
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
| One person on two lines | one open instance per subject; the second entry waits; reach-pass blocks for good |
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
2. **Study line.** The synthesis reader; claims callable; `study_steps` retires.
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

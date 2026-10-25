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
- Two kinds of output: **aggregate** (many sources into one thing: a standard, a report) and
  **per person** (one person acted on: a comment, a DM, an email, a call). Per person never
  sends without his yes (To approve).
- Three things the NFA grows: **rider kinds** (content rides a line, not only people),
  **many-rider stations** (one station acts on every kept rider of a line), and **transfers**
  (a rider on one line makes a rider on another).
- Every fact the machine pulls is a **finding with proof**. His call points at the finding.
- The old hardcoded workflows (keep_warm, close, speed_to_lead, reach.comments, the cadences)
  port to lines **last**.

## Layers

| Layer | Is | Code |
|---|---|---|
| Metro map | the view he draws: lines, stations, tracks | metro body (`packages/pipeline`) |
| NFA graph | what runs: nodes, edges, a rider's state, forward skips | `runOf`, journeys, `pathOf` |
| Executor | runs each move: one event per arrival, retries, timed waits, on Restate | `packages/core/src/executor.ts` (renamed from `spine.ts`), table `events` |

Nothing lives in the executor but plumbing. A workflow is a line.

## The lines

| Line | Rider | Find | Read | Extract | Output |
|---|---|---|---|---|---|
| Video watch | content | the URLs he gives | watch | the basics | stops, for him to discuss |
| Competitor analysis | content | hunt the best sources | watch, read | the kind's rubric | SOP standard and rules (aggregate) |
| Study | page | web search, Perplexity | read | claims with quotes | report and drafts (aggregate) |
| Pain points | post, comment | IG and LinkedIn searches | read | the pain, with its quote | the author transfers to outreach (per person) |
| Outreach | person | lead lists | enrichment | fit, pain | messages that escalate (per person) |

Stations are shared parts: video watch's read and extract are the same stations the
competitor line uses, with find on top.

## Nouns

| Noun | Is | Store |
|---|---|---|
| rider | who or what moves on a line: a person (today) or a piece of content | journeys gain `rider` (`person:<id>` or `doc:<id>`) beside `profile_id` |
| document | one read of one URL: text, transcript, file, duration, stats, `kind`, `owner` (`ours`, `competitor`, `neutral`), who it is about | research `documents`, gains Learn's read columns; `learn.items` keeps feed state and points at it |
| finding | one answer to one question about one document, with proof and `by` (`model`, `code`, `hand`), on one line | research `findings`, gains `line`, `question`, `proof`, `by` |
| proof | `{quote}` on a page, `{t, len}` in a video, `{frame}`, or `{method}` for code | in the finding |
| call | his keep, tune or drop with words, on a finding or a document | `decision_calls`, decide kinds `finding` (was `learn_fact`) and `document` (was `learn_worth`) |

Rules:

- A model finding whose proof is not on the document drops (the study's rule, now on all).
- Documents are shared; findings and calls belong to a line. One film feeds two SOPs.
- A live thread is who the document is about; each new message is a new document.
- A finding that answers no question is allowed only on a kept document (cost).

## Stations

| Station | Does | Settings | Today |
|---|---|---|---|
| find | makes candidate riders | sources (hunt topics, `ytsearch`, Exa, Perplexity, Ad Library, followed creators, saved links, IG or LinkedIn search, a URL list), cap per run | `sop hunt`, the study plan, `pullCreators` |
| read | candidate → document | reader by medium: page (fetch ladder), video (video-watch on the Mac), post (site API) | `readQueued`, `watch` |
| extract | document → findings | questions: the kind's rubric plus the line's own; before or after the keep | `breakdownItem`, study claims |
| call | waits for his call, or applies a rule | mode `every` (his only; To call queue) or `rule` (decide gate after it matches him) | `recordCall`, `lead_fit` |
| standard | many-rider: kept findings → `standard.md`, `calls.md` | the SOP | `sop sync` |
| synthesis | many-rider: kept claims → report and drafts | the question | study report, drafts |
| transfer | a kept rider makes a person rider on another line | the target line and station | none |
| measure | our result per line: our piece's numbers, a reply, a booked call | the measure | `learn back` |

What the kind decides: the reader, the default questions, the closed sets the standard
counts, the proof type. What the line decides: sources, caps, its own questions, call mode,
output, measure, where it stops. To add a kind (ad, landing page, offer, cold email, article,
episode): one question set and one find source; a reader only for a new medium.

Logged-in finds and reads (IG, LinkedIn, X) use the reach engine's shared reads
(`2026-10-25-reach-engine.md`). A line never polls a platform on its own clock.

## Edge cases

| Case | Answer |
|---|---|
| One person on two lines | one open journey per person rider; the second transfer waits; reach-pass blocks for good |
| Our own piece | `owner = ours`; never in a competitor standard; measured by learn back |
| A competitor who is also a lead | the person is the rider; the line decides the act, not the owner tag |
| Cost | caps on find; few cheap questions before the keep, the rest after; USD per day per line |
| Logged-in reader | the line names the account and its cap; personal accounts stay research reads |
| 500 leads | call mode `rule`; `every` is for pieces he studies; no sample mode now |
| Re-extract | his calls point at finding rows, so nothing is orphaned |
| Client workspaces | lines live on their own map; only Wren's SOPs export to `sops/` |

## Phases

0. **Rename spine to executor.** Code, Restate service (both names served for one release while
   the phone Worker moves to `Executor/hook`), the views `spine_events` and `spine_executions`,
   map cards. Dated design docs keep their words.
1. **Content riders and the competitor line.** Rider kind on journeys; documents and findings
   as above; his calls remap from jsonb paths to finding ids; the find, read, extract, call
   and standard stations; the launch-films line on Wren's map. Builds 1 to 10 of the analyzer
   port onto it, nothing he called is lost. Video watch alone is the same line stopped after
   extract.
2. **Study line.** The synthesis station; claims callable; `study_steps` retires.
3. **Pain points.** The transfer station; the outreach side behind To approve; measure per line.
4. **Port the old hardcoded workflows** to lines, last.

## Out

- Tokens (one rider in two places): wait for the first split a client needs (10-23 doc).
- A sample call mode. New readers (PDF). Shot labels (proof failed).

## Decision log

- 2026-10-25: William: one general system on the newest stack (metro map → NFA → executor), no
  drift. Aggregate vs per-person outputs; findings with proof; one document store; decide
  modes for his calls. Old hardcoded workflows port last. Rename spine to executor.

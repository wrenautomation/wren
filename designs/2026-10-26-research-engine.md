# Research engine: raven, weaver, scribe (2026-10-26)

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
| read | document → text, frames, speech | scribe |
| extract | text → candidate findings with proof | scribe |
| call | keep or drop, with a note; the label | William or a rule, in wren |

A query: `{ask, kind: web|video|channel|person|site, site?, terms, why, from: ai|human}`.

Filters, three grains, no score column anywhere:
- before the read, on the hit: raven decides read or skip from what a hit shows for free (title,
  channel, length, date, snippet) and the yield table. It may plan a cheap read first (captions,
  first minutes) and a full read only if the sample yields: a loop edge.
- after the read, on the finding: scribe extracts against the ask. A document that yields nothing
  is the filter result. Scribe proposes; it never keeps or drops.
- the call: the final filter and the label.
Good and bad are learned afterward from the yield table (hits, reads, proposed, kept, per source,
channel and ask kind). Raven reads it next time. A bad channel is skipped because it never
yielded, not because a rule said so.

## Products

Three public npm packages under the `@wrenautomation` scope. No database. Each useful alone.

- **raven**: ask → plan. Owns the query type. Depends on nothing.
- **scribe**: document → text → findings. Takes bytes, text or a local media file path. Owns the
  document and finding types. Keeps `text`, `watch`, the video and audio readers over a local
  file, `htmlText`, `pdfText`, the study extractors. Depends on nothing.
- **weaver**: query → hits → documents, the runner that drives the line, and the ledger contract.
  Holds every source adapter: autobrowse sites, SearXNG, Exa, the connectors, the polite fetcher
  and fetch ladder, robots, yt-dlp (search, list, captions, download). Depends on raven and scribe.
  `weaver` CLI runs an ask against a files store.
- **autobrowse**: one source behind weaver's interface, the only one with a browser. Name stays.

Dependency cut: one direction only. The composer depends on its steps; the steps know nothing of
each other or of the order. The order is data (raven's plan, the NFA weaver runs), not code
structure, so a loop edge or a cheap-read-first pass changes a plan file, not a package. No shared
types package: each type lives where it is produced, weaver imports both.

What moves out of scribe when weaver is built: the `fetch` door's fetcher, ladder and robots;
`flatPlaylist`; the yt-dlp calls inside the video readers (readers take a local file plus optional
caption text). `htmlText` moves to `text`. Nine wren pins change once.

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

## Phases

- 3.5 **Query layer** (between ingestion phase 3 and 4; `2026-10-25-ingestion-engine.md`):
  a. the dependency cut: fetch, playlist and yt-dlp out of scribe into weaver; scribe readers
     over a local file;
  b. raven: query type, planner over a plan file, read-or-skip on hits, loop edges;
  c. weaver: source interface, registry, runner, ledger contract, files backend, CLI; sources
     autobrowse sites, SearXNG (Docker), Exa, the ledger itself;
  d. wren: ledger tables (query, hit, document, finding, call, snapshot, yield), the Postgres
     backend, the pain and study lines' find stations onto weaver, agent CLI (list, add, edit,
     answer a query; keep, drop a finding), portal ledger page.
- 3.6 **Extract and call as one shape** across lines: one call command, one call page, so the
  designer-site example runs end to end.
- 3.7 **Ask**: a thin surface over the same records.
- 4 **Port the old hardcoded workflows** to lines, onto the shared find station.

## Out

- A score column. Scores are learned from yield.
- A strict loop with a stop rule. Budget is a guard rail; raven records why it stopped.
- Renames of scribe and autobrowse: the names say the job.
- A name for the call: it is wren.

## Log

- 2026-10-26: conception agreed. Names: ferret → raven, reach → weaver. Dependency cut agreed in
  principle. Nothing built yet; scribe 0.2.0 still holds fetch and the yt-dlp readers (WA-886).
  Phases wait on William's greenlight.

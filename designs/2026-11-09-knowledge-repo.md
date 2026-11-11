# Knowledge repo: git as the store, Postgres as the index (2026-11-09)

Task WA-1203. Status: agreed (William, 11-09: "This makes sense … let's go … log it into the design doc").

## Goal

Every result we trust is in one place, as a record linked to its evidence. Results come from Vireo
winners and locked tips, Weaver findings, Orrery lanes that close, and William's own rules. Records
are plain files: Claude Code edits them, William opens and passes them around like docs. The SOPs, the
skills and the portal's graph are views. The Voice and facts page (deleted 11-08) is
replaced by this.

## Decision

Options (11-09):

| | Store | For | Against |
|---|---|---|---|
| A | Postgres rows, files compiled out | Constraints in the DB, many writers | Files are copies: a hand edit is lost at the next compile |
| **B. Git files, Postgres index** | **Markdown + frontmatter in a git repo; a sync builds the index** | **Files are the truth: edit, share, diff, blame; agent changes reviewed as PRs** | **Cross-record rules hold only through the lint; portal edits are commits** |
| C | Graph DB (TerminusDB) or an Obsidian vault | Backlinks native | A new server, or a viewer with no evidence gate |
| D | Event log only, views computed | Full replay | Most machinery; every read is a computed view |
| (also) | Dolt (SQL with git branches) | Closest on paper | Second DB engine, Postgres flavor young, not plain files |

Picked B. Priorities, in order: 1) every rule traces to evidence, 2) agents drive it with a CLI and
JSON out, 3) William can read, share and veto any record without our UI, 4) one store for every
product, 5) low $ and few servers. A came first; William's 11-09 point moved it: files are what people
pass around, and a DB with a file export couples everything to our UI.

Prior art: Backstage's catalog (YAML in git → Postgres, eventually consistent), GitOps (Argo CD, Flux),
TinaCMS self-hosted (git content, DB index, UI edits as commits).

Scope: the curated layer only. Hot data (Vireo scores, Weaver run events, pages, clicks) stays in
Postgres and S3. The repo holds what changes a few times a day, not every second.

Way back: the index has the same schema as the files. If writes outgrow git, Postgres becomes the store
and git an export. The data model does not change.

## Guarantees

- **Atomic:** one commit = one transaction. A promotion that adds a rule and moves three cites is one commit.
- **Concurrent writers:** the branch head moves only from the version a writer started on (CAS). A push
  that loses rebases and retries. One file per record, so most rebases are clean.
- **Cross-record rules:** the lint runs on the merged tree before the head moves: a pre-receive hook on our
  own git server; on GitHub, our write service checks before it moves the ref. A merge of two clean
  branches that breaks a cite is refused.
- **Eventual consistency:** the index stores the last commit it applied. A sync applies the diff from that
  commit to HEAD and the new SHA in one Postgres transaction, so a replay is safe. Full rebuild from the
  files repairs any index. Each read can say which commit it reflects.
- **Read your writes:** the write CLI syncs the index right after its commit.

## Shape

The repo is `sops/` grown and renamed `knowledge/` (private; 81 commits of history kept). Its SOP
folders already hold the pattern: `sources/` (a source), `points/` (findings with cites), `SOP.md`
(cited rules), `notes.md` (William's own rules, never written by code).

```
knowledge/
  sources/<id>.md        type: source. a site, a reel, a video, a person, a tool; media in S3 by hash
  findings/<id>.md       type: finding. one claim, its quote, the source and page it came from
  verdicts/<id>.md       type: verdict. a Vireo winner or locked tip, an Orrery lane's result
  rules/<topic>/<id>.md  type: rule. one rule line; cites findings, verdicts or William
  topics/<name>/         notes.md (William's), SOP.md + SKILL.md (built views), refs/
  direction/             dated direction docs
```

Frontmatter on every record: `id` (readable: a source keeps its natural id, `youtube-uSTGNHGFOAo`; a new
one is a title slug plus 6 random characters), `type`, `title`, `by` (agent id or `william`), `why`, `cites`
(ids), `version`, `status` (live | retired), `created`, `updated`. A changed record bumps `version`;
git keeps every past one. Stale marks live only in the index, so the index never writes a file.

Writers: agents through the `knowledge` CLI (`add|edit|retire|apply`, then `show|find|stale|lint|sync|push`;
JSON in and out, `--by` and `--why` required), William by hand or through Claude Code. Promotion is an agent step: it cites the evidence
and says why.

Views: `topics/*/SOP.md` and the `sop-*` skills built from rules; the portal's graph and record pages
on the index (WA-1281), drawn with the same graph kit as the Weaver run page. No Quartz (11-10).

Tool skills (handoff, stageshow, variations) stay in wj_skills for now. Later they move into a
`skills/` area here, with the plugin build compiled out.

## Clients

One repo per client on a self-hosted Forgejo, once clients write. No API caps (GitHub allows about
80 writes a minute, 500 an hour per account), a client's data is one repo they can take with them, and
deleting it is one step. The admin view reads one index over all repos, keyed by repo.

## Order

1. Format and tools: the schemas, the lint, the local index (PGlite, as Vireo does), the `knowledge` CLI. Pick
   the parser first: Velite, markdowndb, or gray-matter + zod.
2. Move `sops/` in: rename, split SOP lines and points into records, rebuild the views, relink skills,
   update `WREN_SOPS_DIR`.
3. Ingest: William's source list (WA-1195, built in his own session, then one import), the reels, the
   Weaver ledger's findings, Vireo verdicts. WA-1210's re-ingest runs here.
4. Content strategy on the result (personal channel; next after ingest).
5. After WA-1217 (own runtime) lands: the prod index in wren's Postgres, portal views, the admin
   multi-repo view, Forgejo per client.

Steps 1 to 4 do not touch the wren runtime, so they do not wait for WA-1217.

## Log

- 11-09 (WA-1228): `@wrenautomation/knowledge` in engine. Parser: gray-matter + zod (mddb has had no release
  since 2024; Velite compiles a whole site, which Quartz does). Index: drizzle on PGlite or Postgres, no
  migrations: a schema change drops and rebuilds it from git. Rows keyed by repo for the admin view. The
  lint at push and at a server hook refuses only faults the change made, so an old fault never blocks.
- 11-09 (WA-1229): the move is done (knowledge ebd52e1; GitHub repo renamed to `wrenautomation/knowledge`,
  `sops` is a symlink). New record type `guide`, one per SOP: the old SOP.md body, `[n]` = the nth id in its
  `cites`; `knowledge render` adds the Sources list. Chose one guide per SOP over sections as findings: the
  text is written whole by one model call and read whole, so one record keeps one diff per build. 38 sources
  (copies shared by two SOPs merged into one record with both tags), 1230 findings (one per point or passage,
  `must` tag for `- !`), 14 guides. Proof: every points file and all 14 SOPs rebuild byte-equal, blank lines
  aside. wren `sop` writes records through the package (9a8b862e7); `knowledgeDir` replaces `sopsDir`.
  pglite became a peer of the package (0.59.1): a pinned copy split the consumer's drizzle-orm in two.
- 11-09 (WA-1230, step 3a): Weaver findings in. Options: A) every kept finding promoted by code, B) an agent
  picks findings one by one, C) the repo keeps pointers to the ledger only. Picked A. Priorities: 1) every
  record traces to a quote (the extract's quote gate already holds it, and a failed check writes a drop, so
  "kept" is the trust bar), 2) keep data, 3) no agent judgment on a fixed step (10-28 rule). B costs a model
  pass over 4,917 findings for a filter the gate already did; C leaves the repo blind to search and links.
  `weaver promote [runs]` (engine 0.60.0): a read page → a source, a kept finding → a finding (quote, page,
  at, run, ledger id, the check's word, class, the ask), a pattern → a new record type `pattern` that cites
  its findings and keeps `sites`. Chose a type over a finding with no source (breaks the finding's one-source
  rule) or a rule (a rule is a procedure line). One source per URL: `sourceId(url)` in the package
  (`youtube-<v>`, `instagram-<code>`, `reddit-<post>`, `hn-<item>`, `x-<status>`, `arxiv-<id>`, else
  `web-<host+path>`), plus a lookup by `urlKey` so a SOP's copy merges. Page text stays in Weaver's page
  store (hot data, S3); a source keeps `textSha256`. Ids end in the ledger id's tail: a rerun is a no-op and
  retires a finding dropped since. One commit per run. Backfill: 39 runs, 32 commits, 4,917 findings, 854
  sources, 54 patterns, lint clean. The skill runs `promote` after a run's stop edge.
- 11-09 (WA-1230, step 3b): Learn's items in. `wren learn promote`: each item → a source named by
  `sourceId` (caption and transcript as the body; breakdown, stats, score, triage, saves, moments as fields).
  Player state and the signed media URL stay in Postgres; the embedding is rebuilt from text. Who owns what:
  Learn's own fields (`learnItem`, `breakdown`, `stats` …) follow the item on any record; title, URL and the
  body follow it only where Learn made the record (`origin: learn`). On an SOP's record they fill gaps, so a
  guide's source never loses its text. One commit; a rerun is a no-op. Run: 573 items, 568 sources added,
  5 SOP sources merged.
- 11-09 (WA-1230, step 3c): Vireo verdicts. `wren variants promote`: a kept sample (the catalog) and a
  locked tip → a `verdict` (`from: vireo`, `ref` = batch ref or `guide:<id>`), with score, zone, notes,
  lineage, the batch's why; a tip carries its with-vs-without good rate. Scores stay hot in Postgres.
  One keep or lock = one record, keyed by sample + `keptAt` (guide + `decidedAt`); un-keep, unlock or drop
  retires it, a re-keep is a new record (the store never revives a retired one). Code lives in wren's
  host (`@wren/variants/knowledge`), not in Vireo: Vireo stays free of a knowledge dependency, and the
  host already reads prod. Prod today: 0 kept, 0 locked (25 tips testing), so the first run writes none.
- 11-10 (WA-1281, William: "seems like we could render it the same way weaver does", my call): the second
  brain view uses the Weaver run page's graph kit (packages/ui graph: xyflow + elk, search, facets), fed
  by the index. Quartz dropped: a second stack and a second copy of every record for one more reader.
  Options weighed: Quartz static site (free backlinks and full-text, but a separate build and look);
  Obsidian-style force graph (shows all ~7.5k records at once, unreadable at this size); the shared kit,
  starting from search or one topic and expanding cites on demand (one part, one look, reuses work).
- 11-10 (WA-1164): the unit of the brain is a topic with three layers (William: "this split as the atomic unit
  of our brain makes sense"). Split by how a thing changes and how it loads: a procedure (few, changes by
  decision, loaded whole) = the topic's `guide`; rules and gates (hundreds, change one at a time, a whole set
  loaded per phase) = `rule` records in `rules/<topic>/`, one set per record, one rule per line with a fixed id
  (`SV-7`), its source as `[n]` or "(William)", and "Hard gate … Check:" where a script or a listed proof
  holds it; references (thousands, change all the time, queried, never loaded whole) = `source` records
  tagged `reference` (`kind: site` = catalog, else one example). Links point one way: a guide names rule
  sets, a rule cites sources, a reference cites nothing above it. Options: A) one mixed guide per SOP (as
  before: no way to replace or trace one rule), B) three layers, C) every rule as code (most design rules are
  judgment), D) one index fetched per task (an agent never knows it saw every rule). Picked B, with C only
  where a rule can be scripted (`topics/<topic>/checks/`). Priorities: 1) the agent sees every rule for its
  phase, 2) each rule has a source, 3) cheap change. A rule set is one record, not one record per line: the
  line id plus git history gives the same override trail without hundreds of files; this changes the 11-09
  "one rule line" per record. How it evolves: a new source changes a named line with a why (two sources that
  conflict on taste: William decides); a soft rule that fails twice in review gets a script and becomes hard;
  a page kept from a catalog becomes its own `reference` record with `from: <catalog>`.
  First topic: `ui-design` (knowledge 96cda95, 7f542d6). One guide (look, spec, build, break, prove, hand
  over), seven rule sets (states, structure, craft, tells, laws, motion, art; 194 lines), checks `shoot.mjs`
  and `tells.mjs` (Hallmark's sloplint at app scope plus the stripe search). The guides `ui-structure`,
  `ux-laws` and `app-polish` are retired into the sets; Impeccable's craft floor, operate, polish, harden,
  typeset, animate and iOS rules are extracted and the skill is unlinked; the `ui-design` plugin left
  wj_skills (6596aeb) and the skill is now `knowledge/topics/ui-design/`. Not done: `wren sop build` still
  writes one mixed guide, and the other 13 topics keep the old shape (WA-1288).
- 11-10 (William: app design "is like a branch or variant of the general ui … a sibling skill"; "sops should
  have granularity on a split level so multiple skills can reference the same set of rules or subset of
  rules"): a rule set has one owner topic and many users. `app-design` is the second topic (knowledge a5441be,
  06a9118): its guide cites the seven `ui-design` sets and four of its own (`native` NA, `navigation` NV,
  `motion` AM, `performance` PF; 59 lines), with proof in the simulator. Three grains of reuse: 1) a set, the
  unit a skill loads; 2) a line, by its fixed id, for a subset (`topics/rules.mjs <set> --only SV-1..SV-6` or
  `--except MO-5..MO-9`; a range that names no line fails); 3) a split, when a second skill often needs one
  part of a set: lines move to the new set and keep their ids. A guide now cites every set it uses, so
  `knowledge show <set>` lists the skills that lean on it and `knowledge stale` lists them after it changes.
  This replaces "a guide names rule sets" in prose only. Where an own set and a shared set both speak, the
  own set wins; where it replaces shared lines outright the skill loads the shared set without them. Options
  weighed: copy the shared lines into each topic (drift, two ids for one rule); one flat pool of rules picked
  by tag (no owner, and no agent knows it saw every rule for its phase); sets owned by one topic and cited
  by any guide (picked). Line ids are unique across the repo (11 prefixes, 260 lines); a lint for that and
  `knowledge render --lines` in place of `rules.mjs` go to WA-1288. The `app-design` plugin left wj_skills
  (52624a2); its six how-to files are `topics/app-design/refs/`.
- 11-10 (WA-1288): `wren sop build` writes the three layers (procedure, rule sets, references; the WA-1164
  entry above), and 12 of the 13 older topics with a guide have them (`video-editing` has none: no rule
  line of it cites a source; `launch-films` has no guide). The model still reads and writes one markdown
  doc; a rule set is a marked block in it (`<!-- set <id> <PREFIX> "<Title>" -->`), and code splits the
  reply into the guide and one rule record per block (`packages/research/src/sops/sets.ts`, `docChanges` in
  `index.ts`). Ids flow one way: the owner's set, then the guides that cite it and name its lines, then
  each SKILL.md. Code owns the ids: a kept line keeps its id, a new line takes the next number after `last`
  (the highest number the set ever gave), a dropped id is never used again, and an id the stored set does
  not hold fails the build. A build also fails when: a stored set is missing from the reply (a person
  retires a set with `knowledge apply`); a set cites no source and no call; the procedure names a line id
  that is not live in a set it cites; it drops a line that another guide names; a cited set is retired; a
  record changed while the model wrote; the topic's sets were written by hand (`ui-design`, `app-design`:
  edit those with `knowledge apply`). An unchanged set or guide gets no edit, so a build does not mark the
  guides that cite a set stale for nothing. A reworded kept line is allowed (the notes or a higher source
  may change it) and the commit's why lists it (one-line items only); the guides that cite the set then
  show in `knowledge stale`. A build never adds a shared set: a person adds that cite.
  Options weighed: 1) one doc, split by code (picked): one call, the model sees procedure and rules
  together, and a rebuild stays a diff. 2) line operations as JSON (add, edit, drop by id): ids are safe by
  construction, but the model writes a patch without the whole text in view; my judgement, not measured,
  is that a schema reply costs quality on long prose (the build prompt has always asked for markdown, no
  schema). 3) two calls, procedure then rules: clean outputs, twice the cost. In 1 and 3 alike the
  procedure can name a new rule only on the next build, once code has numbered it. Priorities, in order:
  ids never move, a rebuild is a small diff, one call. Option 2 wins the first; the id checks above close
  that gap for option 1.
  Migration: a one-off script (not kept) cut each guide at its rules and catalog headings and wrote the
  blocks through `docChanges`; no text was retyped. Check: the bag of words of each old guide against its
  new guide plus sets. The only differences are the hook references below. 16 sets, 188 lines, prefixes CP
  AN HK LI EI LF LP OC MC MA OF MM SA RL SR YU. `content-principles` now owns the 40 hook patterns
  (`content-principles-hooks`, HK-1..40); `linkedin-content` and `meta-ads` cite it and name its lines,
  and the stale file path in `meta-ads` is gone. `seo` has one set (`seo-audit`); its `## Rules` block
  stays in the guide and is already in its `notes.md`. The three uncited `video-editing` rules are now
  also in its `notes.md` (knowledge 8841252), so a build keeps them. Not built: a shared `outward-work`
  set (his yes, fetched text is data, never invent a number): `linkedin-content`, `meta-ads`, `seo` and
  `email-infra` each word those lines for their own channel, some with their own source, and the root
  CLAUDE.md holds the rule; one merged set would mean rewriting them. Engine parts came from weaver dev
  the same day (`@wrenautomation/knowledge` 0.68.3, pinned): lint for line ids (unique prefix, none past
  `last`), `knowledge render <sets> --only/--except <line ids>` and `find --tag`. Each SKILL.md now loads
  its sets with `render`, and `knowledge/topics/rules.mjs` is deleted. Still open with the engine: a lint
  that every line id a guide names is live (today only the build checks it, for the topic it builds and
  for lines it drops).
- 2026-11-10: goldfish review of the entry above: 30 findings, 17 applied (10 in code), 13 rejected; open:
  none.
- 2026-11-10 (WA-1290): the shape is now a topic. `sop-making` (knowledge) holds the procedure for making or
  fixing a topic and four sets: `layers` (SL, which line goes where), `lines` (RW, how a rule line is
  written), `sharing` (SH), `skill` (SK, the SKILL.md door), plus `checks/audit.mjs` (fails a topic with
  no rule set, no proof step or a SKILL.md that does not render; warns on rules left in steps, uncited
  lines, long lines, sets the guide never names by id). `sop build` puts the first three sets in its
  prompt as `<house>` rules, so a build follows the same rules a person does, and changing a house line
  changes every later build. Lines from the notes now cite `[notes]` (they had no cite, so the audit
  could not tell a notes rule from an unsourced one). `sop build --ask "<text>"` adds one instruction for
  one build. Three passes ran on the 13 built topics: split deeper (rules out of steps into sets by
  subject), point by id, and polish (a proof step, notes cites, facts and actions back to their steps,
  one rule per line); the asks are in `topics/sop-making/refs/`. knowledge 0.68.5 lints every line id a
  guide names (live, in a cited set), so the build's own check for its guide is gone; the check for
  lines another guide names stays, because a write lints only the records it touches.
- 2026-11-10 (WA-1290): the repo is named Canon (William). Folder `canon/`, GitHub `wrenautomation/canon`
  (renamed; GitHub redirects the old name), index name `canon`, wren setting `canonDir` (`../canon`, env
  `WREN_CANON_DIR`; was `knowledgeDir`), `shapesGithubRepo` default `wrenautomation/canon`. The engine,
  npm package, CLI and `knowledge.json` keep the name `knowledge`: they are a general record store that
  research, learn and variants use too; Canon is this one repo of it and the way its topics are made.
  Options weighed: Canon for the repo only (picked: agents keep reading the plain `knowledge render`),
  one bird brand for engine and repo (Rookery: fits the product family, tells a new reader nothing, and
  costs an npm rename), Playbook (plainest, but clashes with the content playbook). `knowledge` stays as
  a symlink to `canon/` for sessions that started before the move.
- 2026-11-11: who provided a record, and its edits (WA-1314, engine 0.69.0). William: `by` was overwritten
  by the last editor, so nothing said who provided a source.
  - `provider` {kind: human, agent or weaver; who} is set on add and never changes. An edit may fill it
    once, only on a record made before it. The name `origin` was taken: Learn uses it for the import
    channel (`origin: learn`).
  - Edit history is read from git (`knowledge history <id>`): every store commit already holds
    `Knowledge-By` and the why. Options weighed: an `edits:` list in the frontmatter (it copies git,
    grows each file and conflicts on parallel edits), or a history jsonl per repo (copies git). Git was
    picked; a hand commit shows as op `hand` with its author.
  - Human sources outrank agent ones. A rule line's `[n]` refs walk down to sources, and `[notes]` counts
    as human. Render ends a line that rests only on agent sources with "(agent sources only)".
    `knowledge audit` lists every live line with no human source. On 11-11, 642 of the live lines had
    none: 510 agent only, 132 with no ref.
  - A disagreement is a `conflict` record (`conflicts/`: topic, state open, deferred or resolved;
    lines; it cites both sides). Its topic's render ends with the open ones, so the agent raises them
    with William. Finding a conflict is the agent's call; code only carries the record.
  - Learn: `wren learn add --from william` marks a link he gave as human. Nothing else in Learn tells his
    saves from feed imports (`saved_via` never held portal or shortcut).
- 2026-11-11: Learn is retired; Canon is the one system (WA-1317, William: "everything has to be under the
  new unified system"). The 11-11 Learn work was a mistake: `wren learn add --from`, Learn `provider`
  (ffbaaad38), SL-21 telling sessions to use it, 4 prod rows written to Learn, and `wren learn ads`
  (WA-1301). Learn had stopped taking items on 11-02, but the Mac's `learn-read` job still broke reels
  down every 30 min.
  - Data: a last `wren learn promote` brought 201 sources up to date (transcripts and breakdowns read
    after the WA-1230 migration) and added the ads. His 96 keep / tune / drop calls on pieces
    (`decision_calls` `doc:N`) become `verdict` records, from `owner`, citing the source. Nothing stays
    only in Learn. The `learn` schema's tables stay until William says yes to the drop.
  - What Learn did that lives on, by job: the breakdown of a piece, the standard an SOP holds pieces to
    (medians over kept breakdowns) and the check of a draft or film against it. That code moves to
    `@wren/content-standard`. Its rows come from Canon sources' `breakdown` and his verdicts, not from
    `learn.standards`.
  - Prod cannot read Canon (it is a git repo on the Mac). `wren sop push` computes the standard and the
    calls for the SOP's scope and stores them on the pushed playbook (`content_playbooks.standard`). The
    draft check and the film check read that snapshot. A platform with no pushed playbook gets no
    standard; before, it got a median of every piece Learn read. Options weighed: keep the Learn tables
    as Canon's mirror on prod (two truths, the bug this retires), or a sync job from Canon to a prod
    table (a loop to run and watch, for numbers that change only when an SOP is pushed). The snapshot
    rides the push that already exists.
  - Saving a link is `wren sop add [name] <url> --from <person>`: the name is optional (a link that fits
    no SOP yet), `--from` makes the source human-provided, and a reel or video is broken down on add.
    `wren sop breakdown <source>` and `wren sop call <source> <path> <keep|tune|drop>` replace the Learn
    commands. Competitor ads: `wren sop ads --ads <weaver export>`, one source per ad.
  - Removed: `wren learn`, `@wren/learn`, `wren sop learn-back` (`learn.checks` never held a row), the
    `learn-read` Mac job, the content-line feed (`MapLineFeed`, fed only by Learn items), Learn's
    readers. Old design docs keep their text: they are history.

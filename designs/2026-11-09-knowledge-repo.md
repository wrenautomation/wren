# Knowledge repo: git as the store, Postgres as the index (2026-11-09)

Task WA-1203. Status: agreed (William, 11-09: "This makes sense … let's go … log it into the design doc").

## Goal

Every result we trust is in one place, as a record linked to its evidence. Results come from Vireo
winners and locked tips, Weaver findings, Orrery lanes that close, and William's own rules. Records
are plain files: Claude Code edits them, William opens and passes them around like docs. The SOPs, the
skills, a Quartz site and the portal's graph are views. The Voice and facts page (deleted 11-08) is
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

Views: `topics/*/SOP.md` and the `sop-*` skills built from rules; Quartz for reading and sharing (custom
components allowed); the portal's graph and editing on the index, never a second copy of Quartz.

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

# Weaver seeds: a run that starts from our references (2026-11-10)

Task WA-1164.1 (under WA-1164, the reference record design). Asked through the WA-1195 source walk. Status: design, for William. No build yet.

## Goal

A run can start from things we already trust, plus normal open search. Each finding shows which side found it, so we learn whether our references beat open search.

William, 11-10:
- "make sure weaver dev is doing a thought out design where weaver can take seeds … an implicit version exists where u tell it to search specific websites through the prompt, but thats not i think the best way to do it."
- References are examples. SOPs are procedures. They depend on each other.
- Kept between runs = knowledge. Found for one question = a weaver run. Keepers are promoted back.
- "build me a website for this" = one run with two lanes (seeded and open), one ledger, one judge, each finding marked with its lane. Approved.

Words used here (weaver's, from `designs/2026-10-26-research-engine.md`):
- **Hit:** a URL a search returned, before any read. **Document:** a hit read whole. **Finding:** one quoted claim from a document.
- **Tree, facet, leaf:** the agent's search plan for a round: facets (sides of the question), each with leaves (one search each).
- **Call:** the agent's keep or drop on a hit, with a why. **Brief:** what the agent reads to decide its next step.
- **Promote:** `weaver promote` writes a run's kept findings, and the pages they came from, into the knowledge repo.
- **Lane:** which side of the run a hit came from: `seeded` or `open`.

## What a seed is

A seed is a knowledge record that a run starts from. A knowledge record has an id and a `version` in its frontmatter. A seed can be one of two shapes, and the record's `kind` already says which one:

- **Example** (`page`, `reel`, `post`, `video`): one page we like. The run reads it again, fresh, for this question.
- **Catalog** (`site`, `list`): a site that lists many examples (siteinspire, navbar.gallery, fontsinuse). The run searches inside it for this question and reads what it finds.

Past findings and guides are not seeds. They go in the ask's `known` lines, which already exist: the agent's plan treats them as known and looks for what is new.

### A seed vs sites named in the prompt

| | Sites in the prompt (today) | A seed |
|---|---|---|
| What it is | Words in the ask | A record: id, version, url, kind, tags, what it is good for |
| What the run does | The agent may search it or forget it | A fixed action per kind: read it, or search inside it |
| In the ledger | Nothing ties a hit to the site you named | Each seeded query names its seed |
| Measure | None | Findings per lane, and per seed across runs |
| Reuse | Type the list again each time | Pick by tag: "references for web design" |
| Learn | Nothing goes back | A seed's findings go back to its record; a weak one can be retired |

Today's nearest path, `weaver open --ask --lines`, reads pasted links. `open` writes each one as a hit with no query (`agent.ts:771-777`), so the ledger cannot say where it came from.

## Options

| | Shape | For | Against |
|---|---|---|---|
| A. Prompt and paste (today) | Name sites in the ask, or paste `knowledge` URLs into `open --lines` | No build | No lane and no measure. A catalog is read as one page; nobody searches inside it. Nothing goes back |
| B. `knowledge` as a search source | Seeds come back as hits from a new source; lane = that source | Fits the Source port | Weaver sends every query to every source in the run (`ports.ts:123-135`). The seed query goes to the web, and web queries reach knowledge. Searches inside a catalog run on SearXNG, so they count as open |
| C. Two linked runs | One seeded run, one open run, compared after | No schema change | Two ledgers and two judge passes. A URL that both runs find is read twice. Not what William approved |
| D. Seed ids on `open --lines` | Each pasted line carries a seed id | Smallest change | Examples only: a catalog is still read as one page, with no search inside it |
| **E. A `weaver seed` step** | **The agent names seeds. Weaver writes one query per seed with `seed: <id>`. Examples are read (open's path); catalogs become searches inside their site. Lane is derived from `seed`** | **Exact lanes. One new optional field. Reuses open's read path, `site` search and the yield table** | **Needs a routing fix for site searches (below). The agent picks the seeds, so it is not blind to them** |

Pick: **E.** Priorities, in order:
1. Each finding's lane is exact, so the comparison holds.
2. The agent drives (it picks the seeds, with a why), and code does the fixed steps.
3. One run, one ledger, one judge (approved).
4. Reuse what exists: open's read path, `site` search, `yieldRows`, the knowledge CLI.
5. $: the seed lookup is free; a search inside a catalog costs the same as an open search (SearXNG free, Exa metered).

Prior art: crawler seed lists with a scope rule (Heritrix, StormCrawler), and search domain filters (Exa `includeDomains`, SearXNG `site:`). E uses the domain filters that weaver's sources already take (`searxng.ts:47`, `exa.ts:67`, `google.ts:81`, `perplexity.ts:54`).

## Shape (E)

### Picking seeds

`weaver seed <run> (--id <knowledge id…> | --tag <tag…>) --why "…" [--terms "…"]`
- Runs after `plan` and before `fetch`, in any round. `open` needs a plan the same way (`agent.ts:745`).
- Weaver reads the knowledge repo at its last commit (`loadAt(root, head)`, `knowledge/src/repo.ts:82`), not the working tree, so uncommitted records do not count. The repo path is `--repo` or `KNOWLEDGE_DIR`, as promote finds it (`engine-cli.ts:1350`).
- `--tag`: live records that have every tag named.
- No match: the command fails with `seed: no live knowledge record has tags <tags>`, and writes nothing.
- William can name the seeds or tags in his ask. The agent picks them, with a why.

### What the seeded lane does with a seed

| Kind | Weaver writes | Then |
|---|---|---|
| Example (`page`, `reel`, `post`, `video`) | A query with `seed`, a hit, and a keep call (open's path). The query is never sent to a search source | Read fresh. A follow from it (`follow --as links`) stays in the seeded lane |
| Catalog (`site`, `list`) | A query with `site: <host>`, `seed: <id>` and the `--terms` (the agent's words for this question) | Fetch runs it inside that site. The agent can add more leaves with `site` and `seed` in later trees |

- Never crawl a whole catalog: each search inside it answers this question's terms.
- A catalog record can carry a `search:` URL template (frontmatter is loose: `knowledge/src/records.ts:2`). Then the agent can also open the catalog's own search page and follow its links.

### Two code fixes this needs

1. **Fetch skips a seed query with no `site`.** Fetch runs every query of the round on every source (`steps.ts:267-280`). Without this fix, an example's query would go out to the web.
2. **A site search goes only to sources that declare `keeps`.** Today a source with no `keeps` answers any site search (`ports.ts:132`): `ledger` and `paste` do, and ignore the site. Add `keeps` to searxng, google and perplexity, which already obey `site`. This also fixes open-lane site searches (ask kind `site`).

### Ledger and lane

- One new optional field: `seed: string` (a knowledge id) on `Query` and `Leaf` (`types.ts:58-83`). Nothing else is stored.
- Lane is derived when the run's state is built:
  - A hit is `seeded` if any query that returned it has `seed`.
  - A follow's hits take the lane of the document it started from.
  - A hit with no query (`open --url`, `--lines`) or from a person is `other`.
  - The rest is `open`.
  - A hit both lanes found is `both`. That overlap is a result too: open search also found our reference.
- Documents and findings take the lane of their hit.

### Judge and bias

- The judge labels hits and pages. It never keeps or drops (`judge.ts:1-7`). Both lanes go through the same judge and the same questions.
- The agent picks the seeds and sees them in the brief, so the run is not blind. The measure is per read and per $, not a count, so a lane that gets more reads does not win on that alone.

### Measure

- `yieldRows` already counts hits, reads, proposed and kept findings per source, writer, channel and kind, across runs (`ledger/ledger.ts:69-145`). It gets two more grains: `lane` and `seed`. `weaver yield` and the brief then show:
  - per lane: hits, reads, kept findings per read, $ per kept finding, keep calls;
  - per seed, across runs: the kept findings it led to.
- Visual references carry few quotable sentences, so they can lose on findings per read. Two more measures cover them: keep calls per lane, and keepers promoted (below). Read video seeds with `open --see` when the picture carries the point.

### Back to knowledge

- Promote adds `seeds` (knowledge ids) to each promoted finding that came through a seed. A re-read example seed already matches its own source record by url, so its new findings and runs land on that record (`promote.ts:105-160`). Promote writes a source only for a page with a kept finding (`promote.ts:186`).
- Keepers: the agent adds a page worth keeping as a reference with `knowledge add` (kind, tags, what it is good for), with the run id in its why. It retires a weak reference with `knowledge retire`. No weaver change. William can veto any record in its file.

### Run page

- First: each finding row shows its lane as a word.
- After the first runs: a lane filter and a lane table, if the lane stays. Until then, `weaver yield` shows the numbers.

## Non-goals

- No new `reference` record kind. `kind` and tags are enough to start; WA-1164 can add one later.
- No crawl of a catalog site, and no seed from past findings or guides (those go in `known`).
- No blind triage and no forced read split per lane.

## Risks

- A seed with no `--terms` gives a catalog search with no words: the command requires `--terms` when a catalog is among the seeds.
- A catalog that blocks reads or search: the read fails and is a gap like any other. After 2 failed reads, mark the record so later runs skip it.
- `KNOWLEDGE_DIR` unset on a machine: `weaver seed` fails with the same message as promote. Runs without seeds are not affected.
- The `keeps` fix changes which sources answer every site search, in both lanes. Test it on a past `site` run first.

## Tests

- Lane rules: seeded, open, both, a follow from a seeded document, a no-query hit.
- Routing: a seed query with no site is never fetched; a site search reaches only sources with `keeps`.
- `weaver seed`: tag match, no match (the error), a catalog without `--terms` (the error), reads at HEAD not the working tree.
- `yieldRows`: the lane and seed grains.

## For William

1. **Stop rule.** My proposal: after 3 seeded runs, if the seeded lane's kept findings per read are under half of open's and it adds no keepers, seeds go off by default. The open lane stays on in every run.
2. **Step 0, the first seeds.** The catalog sites (app-polish section 5) are prose today, not records, and no record has a `web-design` tag. The motivating run would find nothing. I propose: one source record per site (kind `site`, tags `reference` + `web-design`, what it is good for), written by the sources session, before the first run.

## Order (when approved)

0. The seed records (above).
1. weaver: `seed` on Query and Leaf, `weaver seed`, the two routing fixes, the lane rules.
2. weaver: `lane` and `seed` grains in `yieldRows`, the lane line in the brief, `seeds` in promote.
3. wren: the lane word on finding rows.
4. First run: "build me a website for <a product>", seeded from the design references, plus open. Read `weaver yield` with William.
5. Later, if the lane stays: the lane filter and table on the run page.

Links: WA-1164 (the reference record), WA-1195 (the source walk), WA-1281 (knowledge record pages), `designs/2026-11-09-knowledge-repo.md`, `designs/2026-10-26-research-engine.md`.

## Log

- 2026-11-10: first draft (a `knowledge` source, a stored lane, blind triage, a read split).
- 2026-11-10: goldfish review: 37 findings (14 critic, 15 reader, 8 zoom-out), 24 applied, 13 rejected or merged; open: the stop rule, and who writes the step 0 seed records. Changed: the Source dropped (it sent the seed query to the web, `ports.ts:123-135`); lane derived, not stored; the routing fix for site searches; yield from `yieldRows`; keepers through the knowledge CLI; blind triage, the read split and `find --tag` cut; `shape` replaced by the record's `kind`; Non-goals, Risks and Tests added.

# Signal collectors (2026-10-06)

William, 10-06 (relayed): "the research signals are useful, tell repo mapping to build out the
signal collectors." And: "the where to check for info table for signal collection is really good
to be built out."

A signal is a specific, timely, citable fact about a person or a firm that makes a message
relevant now. Collectors store signals. Copy picks one per case. Personalization is never a rule
(William, 10-06), so no signal enters a template on its own.

The signal list follows the Research Signal Stack in marketingskills (MIT),
`skills/cold-email/references/personalization.md`. The demand-post buckets and the demand-fit
score are ported from the same repo's `skills/prospecting/references/demand-signals.md`
(marketingskills, MIT), which credits Kappaemme's first-customer-finder (MIT). Their paid sources
(Crunchbase, BuiltWith, HG Insights) are swapped for free ones. The source table's "How to use it"
column is reference for copywriters and stays out of this build.

## Answer first

Two of the eight rows already have collectors. Hiring (`companies/hiring.ts`) and dated firm news
(`companies/events.ts`) write `hiring` and `news` findings, but only in `crm run`. YouTube and
Instagram posts and LinkedIn job changes are findings too. The `findings` table already holds
subject, link, raw document, confidence and how we know. It lacks the signal's own date, so that
becomes a column. There is no new signals table. New: one pool stage, `signals`, which runs a
registry of collectors over the firms and people compose reaches in the next week, on Wren's
niches. Hiring and news join the pool. Six collectors are new: funding (SEC Form D), tech stack,
LinkedIn activity (as `linkedin@alt`), podcasts and talks, website changes, and demand posts. All
of them are free. A console list shows every signal with its date and link. S0 builds the store
and the stage. S1 to S8 are one collector each, each in its own files, so eight implementers can
build them side by side.

## The shared shape (S0)

### Where a signal lives

A signal is a `findings` row (`packages/research/src/schema.ts:187`) with a signal date. S0 adds:

- `signal_at timestamptz`: when the thing happened, or when we first saw it.
- `signal_dated varchar(8)`: `published` (the source prints the date), `approx` (a relative label
  like "2w"), or `seen` (the source has no date, so the date is our read).
- Checks: `signal_at` and `signal_dated` are both set or both null. A row with `signal_at` must
  have `source_url`. The database refuses a dated signal with no link.
- Kinds, added to `FINDING_KINDS` (`schema.ts:176`): `stack`, `site_change`, `talk`, `demand`.
  Signals are these four plus `news`, `post`, `hiring` and `job_change`. `profile`, `still_there`
  and `left` never carry a signal date.
- A partial index on `signal_at` where it is set.
- The view `research_signals`: id, kind, topic, company_id, person_id, subject (name), title, url,
  at, dated, via, confidence, document_id, first_seen (`created_at`), seen (`observed_at`).
- The backfill, in the same migration, dates existing `news` (`value.date`), `post`
  (`value.published_at`), `hiring` (newest `roles[].postedAt`, else `seen` on `created_at`) and
  `job_change` (`seen`). Rows with no link stay undated.

Why reuse: findings already dedupe on `fact_key`, keep the source in `documents`, and feed briefs,
scores, `postFacts` and the reactivation views (`reactivation/src/portal/record-views.ts:137`). A
second table would split every reader.

### Dedupe, date, link, raw

- Dedupe is `fact_key`, one row per (subject, kind, what). Seeing it again moves `observed_at`
  (`findings.ts:97`). Each collector's key is listed in its section.
- `keepFinding` takes `signalAt` and `dated`. When a signal kind comes without them, it reads
  `value.published_at` or `value.date` (ISO), or for `hiring` the newest `postedAt`. It does this
  only when `source_url` is set. YouTube, Instagram and crm run need no edit. Profiles are
  excluded because a channel's `published_at` is its creation date (`youtube.ts:298`).
- `keepSignal(db, draft)` is what collectors call. It refuses a draft with no date, no link or no
  raw (a `document` or `value.raw`) and returns the reason. A refused draft goes into the check's
  `tried` and is never kept.
- Raw is whole. A page is a document, and an API answer is its JSON as a document. Every
  `sites` GET also goes through `keepingAnswers` (`findings.ts:75`).
- The value contract for every signal: `title` (one line, our words) and `topic` (funding,
  hiring, the tech's category, the page, the bucket). Other fields are per kind.

### Checks and pacing

- `signal_checks`, one row per (collector, subject): `state` (found, none, unresolved, capped),
  `found`, `tried` jsonb, `answer` jsonb (a read's summary with no subject, such as an unmapped
  demand post), `retry_at`, `run_id`, `checked_at`. A subject is `c<id>`, `p<id>`, or a post key
  (`reddit:t3_…`, `fb:<id>`).
- Due: never checked, an answer older than the collector's `everyDays`, unresolved older than 30
  days, or capped past `retry_at`.
- Room: `bucketRoom` (`pacing.ts:95`) over the collector's checks in the last two days. A
  collector runs only when its room reaches a minimum batch (`youtube` does the same), so a busy
  pool doesn't spend Restate steps on one unit a minute.
- Google: `googleLeft` (`enrichment/profiles.ts:135`) also counts `signal_checks.tried`. Signals
  get at most 50 of the 200 searches a day.
- LinkedIn: collectors read only as `linkedin@alt`, by name. `readAccount` turns the client's
  `WREN_POOL_LINKEDIN` (the alt's name or its address) into that name. Unset, `linkedin` or
  `linkedin@wren` means no reads. Never William's `linkedin`, never `linkedin@wren`.

### The collector contract

`packages/research/src/signals/index.ts`:

```ts
interface Collector<S> {
  name: string;
  subject: "company" | "person" | "post";
  settings: z.ZodType<S>;            // its own knobs, in its own file
  bucket: Bucket;                    // per day, burst
  everyDays: number;
  metered: boolean;                  // true = one unit per journaled step (Exa, model, LinkedIn)
  subjects?(db, pass, s): Promise<string[]>;     // default: the pass's firms or people
  collect(deps, subject, s): Promise<Collected>; // reads only; the runner writes
}
type Collected = { state; signals: SignalDraft[]; tried: Tried[]; answer?: unknown; retryAt?: Date };
```

`deps` holds `sites`, `desk`, `fetcher`, `pages` (archived HTML), `youtube`, `llm`, `linkedin`
(the allowed account or null), `googleLeft` and `now`. `collect` is pure over those, so tests run
on fakes and synthetic firms.

### Where it runs

- Stage `signals` in `PoolScheduler/<niche>`, after `profiles` (`pool-scheduler.ts:79`). It uses
  the same queue as `profiles`: `nextToEnroll` (`outreach/compose.ts:376`) for a week of opener
  capacity ahead, giving one person per firm, plus that firm. Wren's niches only, since findings
  land on main.
- `Enrichment.signals({personIds, limit})` runs each registered collector: select due subjects,
  then `unitBatches` (`restate/units.ts`), then write. Free collectors batch 20 units to a step.
- `crm run` keeps its own `signals` (hiring) and `events` stages. Fact keys match, so both write
  the same findings.
- CLI: `wren enrich signals --niche <n> [--collector <c>] [--company <id>] [--person <id>]
  [--dry]`. `--dry` prints drafts and writes nothing.
- Component `research.signals`: its settings are each collector's schema, keyed by name. A built
  collector is on by default.

### How it is read

- Console: Outbound, then Signals, a `research.signal` list over `research_signals`. Views: Fresh
  (30 days), All, and one per kind. Filters: kind, topic, dated, via. A row opens its link and its
  raw document. The firm record lists its signals as related.
- Code: `signalsFor(db, {companyId?, personId?, since?, kinds?})`, newest first. A person's call
  includes their firm's signals. Copy and briefs read through it.
- Nothing is merged into `factsFor`. The built `post.*` hook (designs/2026-10-05-social-reads.md)
  stays as it is.

## Collectors

| Signal | Kind | Subject | Free sources, in order | Every | Cap a day | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Job postings | `hiring` | firm | careers page, board API, LinkedIn jobs as `linkedin@alt` | 7 d | 150 firms, alt 10 | $0 | S1 |
| Company news | `news` | firm | Google News RSS, Google page, Exa | 30 d | 200 firms, Google 50 | $0 | S2 |
| Funding | `news` (event funding) | firm | SEC EDGAR Form D | 90 d | 300 firms | $0 | S3 |
| Tech stack | `stack` | firm | stored pages, DNS | 30 d | 1,000 firms | $0 | S4 |
| LinkedIn activity | `post` | person | activity page as `linkedin@alt` | 30 d | 10 people | $0 | S5 |
| Podcasts, talks | `talk` | person | iTunes Search, YouTube search | 90 d | 200 people, YouTube 20 | $0 | S6 |
| Website changes | `site_change` | firm | Wayback CDX, then our own monthly read | 30 d | 200 firms | $0 | S7 |
| Demand posts | `demand` | post, then firm or person | `reddit_threads`, `social_posts`, Reddit search | once | 100 posts, 20 searches | $0 cash | S8 |

Caps are ceilings. The queue (a week of openers) is usually smaller. Restate: about 200 steps a
day, under 10k actions a month of the free 100k, $0.

### Job postings (built: `companies/hiring.ts`)

- Built: `checkHiring` (`hiring.ts:162`) reads the careers page, then the board's public API (8
  ATS, `boards.ts:109`), then LinkedIn jobs logged in. Results go to `company_checks`. It runs
  only in `crm run` (`reactivation/src/signals.ts`).
- Extending means the pool adapter in `signals/hiring.ts`. The LinkedIn step runs only as
  `linkedin@alt` (`company` meter, 10 a day, autobrowse `src/sites/linkedin.ts:166`). The date
  comes from S0's derivation. `hiring.ts` is unchanged.
- Key: the built `c<id>:hiring:<via>:<page>`. Date: the newest posting (`published`), else the
  read (`seen`). Raw: the board's roles, all of them, as the document (built).
- Empty: no board and no LinkedIn page gives `unresolved`, retried in 30 days. A cap parks until
  `retry_at`.
- Read-time note: a staffing firm's board lists its clients' jobs. Its own hiring is internal
  titles (recruiter, sourcer, account manager, business development). The console filters on
  that. The raw keeps every role.
- Cost: $0. Board APIs are public. The alt runs under its cap.

### Company news (built: `companies/events.ts`)

- Built: `searchEvents` searches the Google page, then Exa. It keeps hits dated within 6 months
  that name the firm and match 4 kinds (acquisition, merger, funding, leader). It runs only in
  `crm run`.
- Extending (`events.ts`, `signals/news.ts`):
  - Google News RSS goes first (`news.google.com/rss/search?q=`). It is a public feed with a
    `pubDate` and a link per item, read by `fetcher`, and it spends none of the Google page budget.
  - Kinds become a parameter. The default stays today's 4, so `crm run` doesn't change. The pool
    adds launch, new office, award, partnership and expansion through settings.
  - Each kept hit's JSON becomes the finding's document (today `document: null`, `events.ts:128`).
- Key: the built `company:<id>:news:<url>`. The same story from two sources is two rows. Date:
  the item's date (`published`). An undated hit is never kept (built).
- Empty: `none`, re-searched in 30 days. Exa capped: parked.
- Cost: $0. RSS is free. The Google page uses the shared daily budget. Exa uses the keys' free
  credit.

### Funding

- Press funding is covered by news (`event: funding`).
- New in `signals/funding.ts`: SEC EDGAR full-text search for Form D filings by the firm's bare
  name over the last 12 months (`efts.sec.gov/LATEST/search-index?q=&forms=D`). It is free and
  needs no key. SEC asks for a User-Agent with a contact address and at most 10 requests a second.
  The build confirms the endpoint.
- Keep a filing when the issuer name matches the firm's bare name (and its state, when known).
  Confidence 0.7.
- Stored: a `news` finding with `event: funding` and `via: sec`. Value: title ("Form D filed"),
  issuer, the filing's whole JSON. Key `c<id>:news:sec:<accession>`. Date: the file date
  (`published`). Link: the filing index.
- Empty: most service firms never file, so `none` is the common answer. US firms only.
- Cost: $0.

### Tech stack

- New in `signals/stack.ts` and `signals/stack-prints.ts`. It makes no new page reads. It reads
  the HTML the crawl already stored (`pages`), plus DNS TXT and MX through `node:dns`.
- Prints are our own list of about 40 tools in the categories that matter to our pitch: CRM, ATS
  (from `boards.ts`), booking, chat, marketing automation, ad pixels, site builder, email host.
  Each print is a script host, a meta tag, an SPF include or a verification TXT. GoHighLevel
  (LeadConnector) is on it. No dependency is added.
- Stored: one `stack` finding per (firm, tool). Key `c<id>:stack:<tool>`. Value: title ("Uses
  HubSpot"), topic (category), the matched evidence, the page. Date: the page's fetch date
  (`seen`). Link: the page, or for DNS `https://dns.google/resolve?name=<domain>&type=TXT`. Raw:
  the page's document, and the DNS answer as a document.
- Switching is read-time: a tool first seen after the firm's first stack check is new, and a tool
  whose `observed_at` went stale is gone.
- Empty: no stored page and no DNS answer gives `unresolved`.
- Cost: $0.

### LinkedIn activity

- Job changes are built: `job_change` from the `profiles` stage and lookups (`people/lookup.ts`).
  They need no new reads and show in the list.
- New in autobrowse: `linkedin GET /in/{vanity}/activity` (`max`, default 20). It returns posts,
  comments and reposts with urn, kind, text, the age label, reactions, comments and url. It gets
  its own meter, `activity`: 0 by default, 10 a day for `linkedin@alt`.
- New in wren (`signals/linkedin.ts`): people in the queue with a `/in/` URL, senior titles
  first, 10 a day.
- Stored: each item is a `post` finding on the person, `via linkedin@alt`. Key
  `p<id>:post:<urn>`. Date: from the age label (`approx`). Raw: the item's JSON. Old items are
  kept and filtered at read time.
- Empty: no activity gives `none`, re-read in 30 days. A 429 parks until the cap resets. A failed
  read stops the pass, as `profiles` does.
- Rule: this collector only ever reads as `linkedin@alt`. Any other account turns it off.
- Cost: $0. Page loads run on the Mac.

### Podcasts and talks

- New in `signals/talks.ts`. Subjects: queued people with owner, founder, partner, CEO,
  president or managing titles.
- Sources:
  - iTunes Search API (`media=podcast&entity=podcastEpisode&term="<name>"`), free, no key, about
    20 calls a minute.
  - Then YouTube `search.list` (`q="<name>" <firm>`, videos), only when iTunes finds nothing. It
    costs 100 units each, 20 a day, so 2,000 units. The `youtube` stage keeps at most 6,000 of the
    10,000.
  - The Google page is off by default (budget).
- Keep rule: the full name as whole words, plus the firm's name or domain, in the same episode's
  title or description. Same-name strangers are dropped and stay in `tried`.
- Stored: a `talk` finding on the person. Key `p<id>:talk:<url>`. Value: title, topic (podcast or
  video), the show, the description. Date: the release date (`published`). Raw: the result's JSON.
- Empty: `none`, re-checked in 90 days.
- Cost: $0.

### Website changes

- New in `signals/site.ts`. Pages: the home page and up to 4 stored pages whose path names
  pricing, services, about, team, careers, case studies or work.
- First read: Wayback CDX (`web.archive.org/cdx/search/cdx?url=&collapse=digest&output=json`),
  last 12 months. The newest digest change becomes one signal. Date: the capture (`seen`). Link:
  the snapshot. Raw: the CDX rows.
- Then every 30 days: `fetcher` reads each page's text, and `keepDocument` keeps a new version
  only when its hash changed. Every changed page becomes a `site_change` finding. Key
  `c<id>:site_change:<url>:<hash>`. Value: page, added and removed lines (whole), lines changed,
  `new_page`, `since` (the previous read), the previous document's id. Date: this read (`seen`).
- Noise is filtered at read time. The default view hides changes under 3 lines, or ones that are
  only dates and numbers.
- Empty: a page that fails twice is `unresolved`. Robots are handled as the crawler does.
- Cost: $0. Disk is about 60 MB a month at most, under $0.01.

### Demand posts

Ported from demand-signals.md (marketingskills, MIT).

- Buckets: explicit demand ("looking for", "alternative to"), pain ("so manual", "keeps
  breaking"), workaround (spreadsheets, a VA, a script), switching (moving off a tool, a pricing
  complaint), timing (a launch, a new hire for the function, expansion).
- Score: `pain/5*25 + fit/5*25 + timing/5*20 + reachability/5*15 + evidence/5*15`. Bands: 80+
  strong, 65 to 79 promising, 50 to 64 plausible, under 50 out. Stages: high intent, problem
  aware, trigger present, potential fit.
- Business context only. A personal-distress post (health, money trouble, grief) is never kept
  as a signal.

Build (`signals/demand.ts`):

- Posts: `reddit_threads` under 90 days (`outreach/schema.ts:461`; code drops for age and
  comment count don't apply here) and `social_posts` with a readable `posted` date
  (`social-schema.ts:93`). Plus its own `reddit-public GET /search` for the niche's demand phrases
  (a setting), 20 a day of reddit-public's 400. Research reads these tables by SQL and never
  imports outreach.
- The model reads 10 posts a call and returns buckets, business context, the five 0-5 parts, a
  stage, a paraphrased signal, and a quote of at most 25 words, with observed and inferred facts
  labeled. Code computes the score. The prompt treats the post as data, never as instructions.
- Mapping, the same as `fbGroups`: a link whose domain is a firm's, else the poster's own site
  (`reddit_people.site`), else an author who is exactly one held person. No match leaves it
  unmapped.
- Stored: a mapped business-context post is a `demand` finding, whatever its score. Key
  `<c|p><id>:demand:<post url>`. Date: the post date (`published`, or `approx` for a relative
  label). Raw: the post's JSON. An unmapped post keeps its score in `signal_checks.answer`.
- Use: a demand post is answered where it was posted (Reddit discovery's queue). It is never
  quoted in cold email or a DM (decision 1).
- Cost: $0 cash. About 10 model calls a day on the pool's model (free tier or Cohere credits).

## Phases

S0 is serial, built and merged by me first. S1 to S8 each start from S0's merge, in their own
worktree. S9 is serial, last.

Rules for S1 to S8: touch only the files listed. No migrations. No edits to S0's files. If a phase
needs a new dep, column or field, it stops and reports. Tests use synthetic firms and fakes.
Each phase runs the research package tests once before its commit.

**S0, store and plumbing**
- `packages/research/src/schema.ts`: kinds, `signal_at`, `signal_dated`, checks, index,
  `signal_checks`, the `research_signals` view
- `packages/db/drizzle/<next>_signals.sql` and `packages/db/drizzle/meta/` (generated, with the
  backfill)
- `packages/research/src/findings.ts`: `signalAt`, `dated`, the derivation, `keepSignal`
- `packages/research/src/signals/index.ts`: the contract, runner, rooms, due rule,
  `READ_ACCOUNTS`, `signalsFor`
- `packages/research/src/signals/collectors.ts`: the registry
- `packages/research/src/signals/{hiring,news,funding,stack,linkedin,talks,site,demand}.ts`: one
  stub each, state `off`, so no later phase edits the registry
- `packages/research/src/signals/signals.test.ts`
- `packages/research/src/records.ts` (new, `research.signal` on `@wren/core/records`),
  `packages/research/src/components.ts` (`research.signals`), `packages/research/package.json`
  (exports `./signals` and `./records`)
- `packages/research/src/enrichment/profiles.ts`: `googleLeft` counts `signal_checks`
- `packages/research/src/restate/enrichment.ts`: handler `signals`
- `packages/channel-email/src/restate/pool-scheduler.ts`: stage `signals`
- `packages/channel-email/src/records.ts`: signals related on `email.firm`
- `apps/worker/src/services.ts`: record and deps
- `apps/portal/web/src/modules/wren/index.ts`: the Signals page
- `apps/cli/src/enrich.ts`: `wren enrich signals`
- `map/objects/research/signal.md` (new), `map/processes/pool-feed.md`, `map/effects/CONTEXT.md`,
  `map/CONTEXT.md` (the name collision), then `map/_meta/build.sh`

**S1, job postings**
- `packages/research/src/signals/hiring.ts`, `signals/hiring.test.ts`

**S2, company news**
- `packages/research/src/signals/news.ts`, `signals/news.test.ts`
- `packages/research/src/companies/events.ts`, `companies/events.test.ts`

**S3, funding**
- `packages/research/src/signals/funding.ts`, `signals/funding.test.ts`

**S4, tech stack**
- `packages/research/src/signals/stack.ts`, `signals/stack-prints.ts`, `signals/stack.test.ts`

**S5, LinkedIn activity** (two repos)
- autobrowse: `src/sites/linkedin.ts` (route, `activity` meter, alt cap),
  `src/browser/flows/linkedin-reach.ts` (the read), its test
- wren: `packages/research/src/signals/linkedin.ts`, `signals/linkedin.test.ts`

**S6, podcasts and talks**
- `packages/research/src/signals/talks.ts`, `signals/talks.test.ts`

**S7, website changes**
- `packages/research/src/signals/site.ts`, `signals/site.test.ts`

**S8, demand posts**
- `packages/research/src/signals/demand.ts`, `signals/demand.test.ts`

**S9, close-out** (serial)
- `map/objects/research/signal.md` (verified, one line per collector), `map/processes/pool-feed.md`
- autobrowse `map/` card for the linkedin site
- this doc: a Built section and the log

### Overlap risk

- No two of S1 to S8 share a file. The stubs and the composed settings keep the registry and the
  component out of their diffs.
- S2 edits `events.ts`, which `crm run` calls (`reactivation/src/events.ts`). It must keep
  `searchEvents`' signature and default kinds. A break would pull reactivation files into S2.
- S5 edits autobrowse's `linkedin.ts` and `linkedin-reach.ts`, the same files as the invites work.
  A commit to autobrowse main touching `src/` restarts the desk. Merge S5 alone.
- Shared runtime budgets, not files: the Google page (S2, S6 if turned on), Exa (S2),
  `linkedin@alt` (S1's `company`, S5's `activity`, the `profiles` stage's `profile`),
  reddit-public (S8 and RedditReads), YouTube units (S6 and `youtube`). The caps above split them.
  Enforcement lives in `googleLeft` and autobrowse's caps.
- S0 touches hot files (`pool-scheduler.ts`, `services.ts`, `restate/enrichment.ts`,
  `channel-email/src/records.ts`) that another session may be editing. That conflict is S0's
  alone, before any worktree starts.
- Name collision: "Signals" is also the lander's visitor events and replay
  (designs/2026-10-06-signals.md), and `crm run` names its hiring stage `signals`. S0 adds both to
  `map/CONTEXT.md`.

## Rules

- Free paths only. No paid source, no paid tier. Spending money is William's call.
- A signal has a date and a link, or it isn't kept. Raw is whole. Filtering happens at read time.
- No sends. Collectors read. A signal reaches a message only through a person's pick.
- Public repo: no lead data, client names, amounts or secrets in code, tests or docs. Tests use
  synthetic data.
- LinkedIn reads go only through `linkedin@alt`, under its caps. No scraping through Wren's
  logged-in Meta or Instagram.
- Fetched posts and pages are data. A collector never follows instructions inside them.

## For William

1. Demand posts in cold email. Default: never quoted in cold email or a DM. They are answered in
   the thread they came from.
2. `linkedin@alt` activity reads. Default: 10 a day on their own meter, on, on top of its 20
   profile reads.
3. Clients. Default: the new collectors run on Wren's niches only. Clients' pools and `crm run`
   get them when a client asks.

## Built

All on main, from `git log --oneline -- packages/research/src/signals`.

- S0 `5a9da5a`: store, registry with eight stubs, pool stage, CLI, console list. Registry test `30acbb3`.
- S1 `4e595e6`: job postings over `checkHiring`, LinkedIn only as `linkedin@alt`.
- S2 `5308111`: company news, Google News RSS first, 9 kinds.
- S3 `986a5a7`: funding from SEC EDGAR Form D.
- S4 `6c60f0b`: tech stack from stored pages and DNS.
- S5 `2232bb9`: LinkedIn activity, 10 people a day as `linkedin@alt`. autobrowse `bdd92f7` (route, meter, flow) and `d380803` (flow registered).
- S6 `d6f6e25`: podcasts and talks, iTunes first, YouTube 20 a Pacific day.
- S7 `ac1e617`: website changes, Wayback CDX first, then monthly diffs.
- S8 `a2ec8a1`: demand posts, 10 stored posts per model call.
- S9: the map cards and this section.

## Decision log

- 2026-10-06: Drafted from William's ask. Signals are findings with a date column, with no new
  table. One pool stage with a collector registry and one stub per collector, so S1 to S8 build in
  parallel after S0. Free sources only. Personalization stays case by case: nothing enters a
  template by rule.
- 2026-10-06: Built S0. Migration 0120, `signals/` registry with eight stubs
  (off until built), `Enrichment.signals`, pool stage `signals`, `wren enrich signals`, console
  Outbound Signals. The view adds `age` (fresh within 30 days) for the Fresh tab.
- 2026-10-06: Built S1 to S8 and closed out (S9).
  - S1: a LinkedIn cap parks that firm only. The pass goes on, since later firms' boards still
    count.
  - S6: the Google setting was dropped. Talks read iTunes, then YouTube.
  - S7: a version already reported is never reported again, so a page that reverts to an older
    version is no new signal.
  - S8: stored posts go to the model 10 per call. About 19 calls a day with defaults, 28 with a
    backlog, 100 at most.
  - S5: the read is a new flow file, `linkedin-activity.ts`, not an edit to `linkedin-reach.ts`.
    It is unproven until its first live read as `linkedin@alt`.
- 2026-10-06: First prod run (aid session, recruiting, 5 a collector). Kept stack 5, site 3,
  talks 1. Hiring read no LinkedIn: prod's `WREN_POOL_LINKEDIN` holds the alt's address, not
  `linkedin@alt`, so the name check dropped it. `readAccount` now maps any set pool account to
  the alt by name, except William's or Wren's names. `wren enrich signals` now passes the
  configured model, so demand can read posts from the CLI.

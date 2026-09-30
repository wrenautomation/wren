# Client reactivation (2026-09-29)

The first product wren runs for a paying client, not for Wren's own outbound. A client's CRM export goes in. Out comes a health report, who changed jobs, which past clients are hiring, a cited brief per contact, emails written as the client, and the interested replies handed to their recruiters. Execs watch it in a portal. The demo is the same portal on a sample firm.

## What William decided

- Reactivation is the offer. Paid, not free: $1,000 setup upfront plus $500 per meeting booked, capped at $15,000. A meeting counts when it is on a calendar.
- Credibility is a demo and a clear explanation of how it works, not a free pilot.
- One codebase, in wren. Non-technical staff (owners, C-suite) need a real UI.
- LinkedIn search is in, carefully. The account is set per client. For now it is William's personal `linkedin`, read-only (2026-09-29).
- Full enrichment: LinkedIn, X, Instagram, the web.
- Watch, don't search (2026-09-29): follow people once and read the feed, not a search per person per day. Fewer requests, less risk of a flag.
- The sample firm is built from a real recruiting agency's public data.
- Monorepo, not a new repo (2026-09-29), with clear layers (below). Reactivation is one product on foundations William also uses himself (lookup, research, email checks). It must scale to 50+ clients, each with its own fulfilment details, on the same parts.
- Easy to use (2026-09-29): one command per job, plus a `wren` skill (`.claude/skills/wren`).

## Shape

| Piece | Where | What it does |
|---|---|---|
| Client registry | main DB `clients` table | id, name, database, accounts, product settings, portal emails, demo flag |
| Client database | one Postgres database per client on the same server (`wren_client_<id>`) | the full wren schema, migrated like main; nothing shared with Wren's own leads |
| `packages/reactivation` | new | CRM export formats, health report, contact scoring, the reactivation composer, reply handoff |
| `packages/research` people + signals | extended | person lookup, job changes, hiring signals, social posts, findings, cited briefs |
| `wren --client <id>` | CLI | every command runs against that client's database |
| `apps/portal` | new | the Cloudflare Worker (Access check, `/api` → Restate) + `web/` (React SPA); the API is `ReactivationPortal` in `packages/reactivation/src/portal` on the worker |
| Demo | `demo.wrenautomation.com` | the portal on client `demo`, no login, people masked server-side |
| Offer | `packages/offers` | `reactivation` offer with a new `performance` price kind |

## Layers

Three layers. Code only points down.

- **Foundations** know nothing about clients or products. These are core, db, config, llm, research (people lookup, findings) and the channels (email checks, sending, sites). Each takes a database and a site client, so William can use any of them directly for personal work on the main database.
- **Products** build a pipeline out of foundations. There is one package per product, and reactivation is `packages/reactivation`. Products never import each other. When two products need the same thing, it moves down into a foundation.
- **Clients** are data only: a registry row with a database, accounts and product settings (R21). There is no per-client code and no client name in git.
- **Apps** (cli, worker, portal) wire the layers: pick the client, open its database, call the product.

A lint rule guards this. biome `noRestrictedImports` on `packages/**` fails the build when a foundation imports `@wren/reactivation`, and each new product adds its name to that rule.

## Decisions

- **R1. A client is a database, not a column or a branch.** Branches drift: every fix has to be merged N times. A `client_id` column would touch every table and query, and one missed filter leaks a client's list. A Postgres schema per client fails because the migrations name `"public"` outright (0001 has 51 references). A database per client runs the same migrations unchanged. All existing code (import, verify, compose, send, inbox sync, classify) works as is. Offboarding is `DROP DATABASE`. One Postgres server, so there's no new infrastructure.
- **R2. The registry lives in the main database, not in code.** Repos are public (PolyForm Strict) and a client's name must never land in git. `clients` holds the database name, not a URL: the URL is the main URL with the database swapped, so no new secret.
- **R3. Pools stay tiny.** Postgres connections are the ceiling (the SMTP-prober lesson). A client handle opens with `max: 2`, is cached per process and closes when idle. The CLI opens one per command.
- **R4. The worker gains a client dimension.** Client loop objects are keyed `<client>/<unit>` (`clientKey`, `core/restate/keys.ts`); ids never hold `/`. Wren's own loops keep their plain keys, so nothing live changes.
  - `SendScheduler` and `InboxScheduler` take a scope per key: the database, the send policy and fleet, the disposition key. A plain key gets Wren's; `<client>/<mailbox>` gets that client's. A send key whose scope is gone (client off, sending off, mailbox suspended or unlisted) stops itself.
  - `Reactivation`, keyed by client id, is the one loop per client. Each pass (10 min) plans from the registry row, runs what is due of verify (only when the verifier is free), score, brief and compose, a bounded slice each, then points the mailbox loops: an inbox loop per listed mailbox while the client is on, a send loop per unsuspended mailbox while `stages.send` is on. It re-starts them hourly and after a resume, in case one stopped itself.
  - `on` is the one switch. Off, the loop idles and stops the mailbox loops; on again needs nothing else. It stops itself only when the client is gone or is the demo. `crm loop start` once per client; `crm loop stop` stops it and every mailbox loop it started; `crm loop status`. A stop then start never leaves two chains of passes: each start bumps a generation and older delayed calls drop out.
  - Lookup and signals stay in `crm run`: they read through a personal account.
- **R5. CRM exports have their own formats and table.** `CRM_FORMATS` in `packages/reactivation`: `hubspot`, `salesforce`, `bullhorn` and `crm-generic`. Each is a header synonym table; a dialect's own names are tried first, then the generic ones. A file with no name column, or no email/company/website column, fails before anything is written, listing its headers.
  - Rows go through the people importer (origin `crm`), so a CRM person meets the same person found anywhere else.
  - Each row is also kept whole in `crm_contacts`: owner, status, last contacted, last placement, date added, the email as the CRM holds it, the raw row. One row per CRM record, keyed by the CRM id (else a row hash), so duplicates stay visible and a re-import updates in place.
  - The CRM's email becomes a `contact_candidates` row with evidence `crm`. `wren crm verify` checks each once (local check, then the prober); it doesn't use the resolution walker, which is built around guessing.
  - Company: the website's domain, else the work email's domain, else a domain another row gave the same company name, else the name (`crm-co:<slug>`).
  - Slash dates are month-first unless any date in the file can't be (a day over 12); the file is one locale.
- **R6. Findings are the unit of research.** Each finding is one fact:
  - kind: `job_change`, `still_there`, `left`, `hiring`, `post` or `news`
  - subject: a person or a company
  - value (JSON)
  - `document_id` pointing at the stored source (the existing `documents` table holds the fetched text), plus `source_url`
  - `observed_at`, `confidence`, `via` (`search`, `linkedin@research`, `x`, `instagram`, `crawl`)

  Nothing downstream reads a source directly; it reads findings.
- **R7. Person lookup is layered, cheapest and safest first.**
  1. The email check (mailifier). A once-valid address that now rejects means the person probably left.
  2. Web search (`web` site: exa → brave → ddg), `"<name>" "<company>" site:linkedin.com/in`, then parse the snippet for the current title and employer. No login.
  3. LinkedIn logged in, only for contacts still unresolved. It runs as the client's configured account, within the caps autobrowse enforces per account per day, and is read-only. Off unless the client row allows it.

  A match needs the name plus a past employer or the email domain in the result. Otherwise it's `unresolved`, never guessed.

  As built (`packages/research/src/people`, `wren --client <id> crm lookup`):
  - Pure over a `SiteClient`; `store.ts` writes. Research owns the lookup, reactivation owns the CRM runner, so any list can use it.
  - Search: two queries at most. A LinkedIn result whose name matches and whose title or snippet names the firm (name, or domain label of 4+ letters) is the match. Its title ("Name - Title - Company") or snippet ("Experience: X") says where they are now.
  - Name match: the given name, then every last-name word after it, so order counts. The first name must be equal, or a short form of 3+ letters that is 3+ letters shorter: Chris matches Christopher, Eric doesn't match Erica. Apostrophes drop, so O'Brien matches OBrien. Half a name never matches.
  - Titles: in "Name - X", X counts only when it is the firm itself. "Former X at Y" and cut-off text ("…") say nothing.
  - Other domains and addresses are blanked before looking for the firm, and so is the person's own name, so "Acme" in "jane@acme-mail.com" or in "Jane Acme" isn't a mention. Email findings come only from an address at the firm's domain.
  - LinkedIn (only when `clients.accounts.linkedin` is set, `--no-linkedin` turns it off): read the half-matched profiles, else search LinkedIn people. A profile counts only with a role at the firm. At most 3 profile reads per person.
  - Confidence: profile 0.9; search 0.7 still there, 0.6 moved; mailbox rejects 0.6, domain takes no mail 0.4; mailbox takes mail 0.5 still there.
  - One `person_lookups` row per person: `matched`, `unresolved` or `capped` with `retry_at`, plus the trail of what was tried. A re-run picks people with no row, or capped and due; `--again` picks everyone.
  - A 429 asking to wait 300s or less is pacing: autobrowse spaces LinkedIn calls 10–30s apart and refuses once a slot is 2+ minutes out. wren sleeps and retries, 3 tries.
  - A longer 429 is a cap. A LinkedIn cap parks that person and every later one at step 3 for the rest of the run, with no repeat asks. A search cap stops the run. Five errors in a row also stop it.
  - Any other 4xx from LinkedIn search is recorded as `refused`, with no match. Text is stripped of NUL bytes before it is stored.
  - The CLI reaches autobrowse through Restate ingress, like the worker, and wakes the box first (`ec2Wake`, moved to core).
- **R8. Company signals come from official paths first.**
  - Hiring: LinkedIn company jobs, plus a web search for job posts. The TS repo has no careers crawler; add one only if these two miss.
  - Posts: the watch feeds (R19). Instagram Business Discovery (official) for business accounts, no follow needed.
  - News: web search.
  - A browser leg only where no API exists, in our own real browser, read-only.

  As built for hiring (`packages/research/src/companies`, the `signals` stage of `crm run`). This replaces the plan above: a job board's own API is exact and free, and web search for posts guesses.
  - The firm's own site first: `/careers`, `/jobs`, the home page, then the one page the home page links as careers. A page that redirects off the firm's site doesn't count.
  - The board it names (greenhouse, lever, ashby, workable, smartrecruiters, recruitee, bamboohr) is read through that ATS's public postings API. One entry per ATS in `boards.ts`. Several boards on one page count only when one of them is clearly the firm's; otherwise none does.
  - LinkedIn only when the client allows it and no board was found. The company's page comes from a matched profile's current role, else the company's own social link, else a search hit whose page names the firm's own website. Then its jobs.
  - Confidence: board 0.95, LinkedIn 0.85. No board and no trusted page is `unresolved`, never a guess.
  - One `company_checks` row per company: `hiring`, `no_openings`, `unresolved` or `capped`, pointing at the hiring finding it stands on. `no_openings` points at nothing, so an old hiring finding stops counting without being deleted. A capped re-check keeps the last real answer.
  - Due again: an answer after 7 days, `unresolved` after 30, `capped` when the cap lifts. Biggest companies (most CRM people) first, 3 at a time. Caps, pacing and error streaks work as in R7.
  - Posts come with the watch (R19). News is deferred: web search for news guesses, and nothing needs it until the composer does.
- **R19. Watch by following, read the feed.** Searching per person per day costs one request per contact per platform and looks like a scraper. Following costs one request per contact, once, and the daily read is one feed per account.
  1. Handles are resolved once, during lookup (R7): the LinkedIn profile, the X handle and the Instagram handle when a result names them. Company pages too.
  2. Subscribe:
     - X: a private List per client. Members get no notification, and the List timeline is one read.
     - LinkedIn: follow company pages (nobody is told). Follow people only when the client row allows it, since the person can see it.
     - Instagram: follow from the client's account, where it looks natural, or from the research account.
  3. Once a day per platform per account, read the feed from the saved cursor. Match each post's author to a watched person or company. Store the post in `documents` and a `post` or `hiring` finding.
  4. Follows are capped per account per day (about 20 to start) and spread over days. A new client's list fills its watch over two to three weeks. Search runs only for the one-time lookup and for news.
- **R9. Briefs are cited or dropped.** The LLM writes a brief from findings only. Each sentence carries `[f<id>]` marks, and a gate drops any sentence whose marks do not point at a finding for that contact (same idea as the reply classifier's quote gate). A brief with no surviving sentence is not stored. It goes through `complete_and_parse` and is a `runs` row with costs.

  As built (`packages/reactivation/src/brief.ts`, the `brief` stage):
  - Facts: the finding that says where they are (the surest, then the latest), their company's hiring finding, their post and news findings, and their CRM rows. CRM rows are cited as `[c<id>]`: "last placement 2024-03" is worth saying.
  - The gate also drops a sentence with a number that isn't in the facts it cites, and anything past 4 sentences. What it dropped, and why, is kept on the row.
  - Every outcome is stored, unlike the plan: `written`, `empty` (nothing survived) or `failed` (unreadable answer). So the same facts are never paid for twice. Only `written` shows anywhere. `failed` retries after a day.
  - Rewritten only when its inputs change: a hash of the facts (without their read date, so a fact read again isn't a change), the CRM rows and the prompt version.
  - Who gets one: score above 0, lookup finished, at least one finding.
  - A provider failure stops the stage. No LLM configured (the fake) stops it with a message; the other stages still run.
  - The call envelope is stored on `briefs.llm`. Owed: a cost view over it, since `email_stage_costs` covers email stages only.
- **R10. Contacts are scored so the best go first.** Hiring at their company beats a job change to a new company. That beats still being there and recently in touch, which beats stale. The score's reasons are stored with it so the portal can say why.

  As built (`packages/reactivation/src/score.ts`, the `score` stage; `crm top` prints the list):
  - Still there and their company hiring 100; moved 70; still there 40; nothing found 10, or 40 if their company is hiring. Left scores 0.
  - A placement in the last 24 months adds 15; a contact in the last 12 adds 10.
  - A hiring finding counts only while it's under 30 days old. A mover's old firm's hiring doesn't count.
  - Each reason cites the finding or CRM row behind it, with the same marks as briefs.
  - Everyone is rescored from one query. Due when someone has no score, when any finding, check or CRM row changes, and daily (the windows move with the calendar).
- **R11. The composer writes as the client.** Input: the client's profile (firm, what they place, voice, the recruiter who knew the contact, signature) plus the brief. One email and one follow-up, lowercase subject, plain, per the cold-email SOP. The client approves the first batch in the portal before anything sends.
  - A gate drops drafts with prices, links, addresses, dashes, placeholders, or numbers not in the brief; the subject gets the same checks plus names.
  - People who moved are skipped: their CRM address is at the old firm.
  - Suppressed contacts are excluded in SQL. A draft that loses a race to another pass is stored as `raced`, not a failure.
  - `approval: first` means the first batch waits for the client, then drafts flow. `every` means each batch waits. Approve or skip in the portal (Emails) or `crm approve|skip`; `crm emails` lists them.
- **R12. Sending uses the existing machine.** Enrollments, pacing, roster and the Gmail transport, from domains we set up for the client (lookalike domains, mailboxes in the recruiter's name with written consent), warmed about 10 days. Never from the client's own domain.
  - The mailboxes live in Wren's Workspace, so Wren's Gmail transport and reader serve them. They are listed in the block's `senders`; a suspended one still syncs its inbox but never sends.
  - The client's policy is Wren's window, days and gaps with its own caps (`sending.perInboxPerDay`, `openersPerDay`, `rampStart`). Wren's opener cap and ramp are Wren's campaign's and are not inherited; the ramp never starts above the client's ceiling.
  - Client mail carries no open pixel: its opens would land in Wren's database.
- **R13. Replies go to the client.** Inbox sync plus the classifier. An `interested` reply is forwarded to the recruiter named on the contact (else the client's default), shows in the portal and pings the client. "Meeting booked" is marked by the recruiter in the portal or by us (`crm book`), and it's the billing unit.
  - Forwarding (step 7e): each pass of the client's loop, while `stages.handoff` is on, sends each `interested` or `meeting_booked` reply (or one marked booked by hand) from its mailbox to the recruiter the composer wrote as, else the firm's default. The forward's Message-ID is stored on the handoff row before the send; a retry asks the mailbox for it first, so a crash never forwards twice. The row is locked while it is sent, so overlapping passes never both send. The oldest try goes first (`attempted_at`), so a forward that fails every pass never blocks newer ones. A reply relabelled cold, or a booking taken back, stops going. It never goes back to its own mailbox (one in a recruiter's name): the default recruiter takes it, and with nobody else it waits. The operator hears each forward (no contact names), and once when forwards start failing.
  - The bill is `upfront + min(meetings × perMeeting, cap)`, shown on Replies to the owner only.
- **R14. Portal: one Cloudflare Worker (`apps/portal`), API on Lambda through Restate, Cloudflare Access login.** Setup and checks: `deploy/portal.md`.
  - One Worker on two hosts: `app.` (Access) and `demo.` (no login). It serves the React + Vite app and proxies `/api/<route>` to the `ReactivationPortal` service on the worker, the way the phone app reads SMS. No Pages project, no public API.
  - Access gives email-code login with no passwords, free to 50 users. The Worker checks the Access JWT itself (RS256, team certs, aud, iss, exp) and sets the viewer; the browser's viewer is ignored. The service maps the email to clients through `clients.portal_emails`. `OPERATOR_EMAILS` (a Worker secret) see every client.
  - Reads run in a read-only transaction on the client's pool. That replaces the planned `portal_ro` role: same guarantee, no role per database to keep.
  - The only writes are approve, skip and "meeting booked", through Restate like the CLI's writes. The demo refuses them at the edge and in the service. A booking is billed, so only the login that marked it, or Wren, takes it back.
  - Pages: **Overview** (people, looked up, moved, at hiring firms, "call these first"), **People** (filters, the drawer with the brief, its numbered marks and sources), **Data health**, **Sources** (every finding by where it came from), **Emails** (drafts to approve or skip, what went out), **Replies** (handoffs, meetings, the bill).
  - Local: `pnpm --filter @wren/portal preview [--demo]` serves the build and runs the same handlers in-process.
- **R15. The demo is client `demo` with `demo: true`.** Every demo answer passes through one mask (`portal/mask.ts`) that walks every string: surnames and middle names become an initial (`Sarah K.`), addresses keep one letter (`s•••@domain`), LinkedIn profile links lose the name. Name search is off on the demo. Company names and sources stay real. `me` names it "Sample recruiting firm". Answers are cached 5 minutes at the edge (200s only). A banner says what's real and what's made up. `test/integration/portal.test.ts` walks every route for leaks.
- **R16. The sample firm comes from a real agency's public data, kept anonymous.** As built: `wren --client demo crm seed-demo --agency <url>` (a `crm` command, so it gets the client's database; refuses unless the client is `demo`).
  - Pick a real recruiting agency of 10–50 people whose site names at least 30 clients (logos, case studies, testimonials).
  - **Customers** (`research/companies/customers.ts`, niche-agnostic): the home page plus up to 8 same-site pages whose path or link text looks like a client list. One model call sees each page's text, image alts and file names, and links off the site. A name counts only when the pages carry it; a website only when a link on the pages points there. The firm itself is dropped.
  - **Sites** (`discovery/find.ts`): the linked site first, else guessed domains; either must pass the ownership gate.
  - **People** (`people/contacts.ts`): one people search per customer (autobrowse `web` `/people`, Exa's index of public profiles, ~$0.007 a search), "talent acquisition, recruiting, HR, or people team people who work or worked at <company>". Each profile comes back with every role: keep a person with a hiring-role title at the firm. That role not current and another one current is someone who left: kept, so the demo has real movers. (2026-09-30: was a `site:linkedin.com/in` web search read from result titles; Exa, the one keyed backend, returns names only there, so it found nobody.)
  - **Made up, seeded by the agency's domain** (same agency, same list): owner, status, date added (3–10 years ago), last contact (mostly 1–4 years ago), last placement (about 6 in 10). Email is the `first.last@` guess at the customer's domain; the verify stage says whether it works.
  - **Mess:** blank titles (15%), a company spelled a second way (8%), a missing site (10%), a contact entered twice (5%). Never a fake bounce or a fake move: those would be claims about real people.
  - Written as a Bullhorn export and imported through the same path as a real client. Each seed wipes the demo's list first. `--csv <path>` saves a copy; keep it out of the repo.
  - The agency is never named ("a 30-person tech recruiting firm, built from its public website"). No emails are ever sent to demo contacts: the demo client has no roster.
- **R17. Accounts are per client.** The `clients` row names each site's account, and wren always passes `account` explicitly. autobrowse enforces caps per account.
  - For now every client uses `linkedin`: William's personal profile, read-only. Its caps are lower than the default (40 profiles and 15 searches a day, asked 2026-09-29).
  - Clients sharing an account split one daily cap, and `clients add|set` warns when that happens. Give a client its own account (`linkedin@<client>`) once volume needs it.
- **R18. Offer.** `reactivation` is a `performance` price: `upfront` $1,000, `perUnit` $500, `unit` "meeting booked", `cap` $15,000. Prices stay off the lander (D14); the portal shows the running bill to the client.
- **R20. One command per job: `crm run` and `crm status`, plus the `wren` skill.**
  - `crm run` does every stage that is due, in order (`CRM_STAGES`: verify, lookup, signals, score, brief). It stops at the first stage that aborts, is recorded as one `runs` row, and resumes when run again.
  - `crm status` says where the client stands and ends with one `next:` line.
  - Later stages (the watch) join `CRM_STAGES`, so the commands never change. The single-stage commands stay for debugging; `crm top` reads the result.
- **R21. Per-client differences are settings, not forks.** `clients.products` is JSON keyed by product: `{ reactivation: { … } }`.
  - Each product parses its own block with a schema and owns the defaults. A bad block fails at `clients set`, not in a loop at 3am.
  - The reactivation block (`settings.ts`) covers:
    - `on`: the one switch
    - `stages`: research, compose, send (off by default), handoff
    - `compose.perDay`, `approval` (`first` or `every`)
    - `sending`: per-inbox and opener caps, ramp start; null keeps Wren's ceiling
    - `senders`: address, From name, recruiter, suspended
    - `offer`: upfront, perMeeting, cap
  - `wren clients set <id> --set reactivation.senders.1.suspended=true --unset reactivation.x`: paths go through arrays, and the product's parser checks the block before it is written.
  - The firm's own details (voice, recruiters, signature) live in the client's database (`client_profile`), because only that client's work reads them.
  - Each client has its own `Reactivation` loop (R4), so 50 clients are 50 small loops, not one walk.
  - This replaced `clients.caps`, which nothing read.

## Data added (one migration, every database)

- `findings` (R6), indexed by person and by company.
- `watches` (R19): platform, account, subject person or company, handle, state (`pending`, `following`, `failed`, `dropped`), followed_at; plus one cursor row per platform and account for the feed read.
- `briefs`: person_id, state (`written`, `empty`, `failed`), text, citations JSON (finding and CRM row ids), dropped JSON, inputs_hash, model, prompt_version, llm (call envelope), run_id.
- `company_checks` (R8): company_id, state, finding_id, tried, retry_at, run_id, checked_at.
- `contact_scores`: person_id, score, reasons JSON, computed_at.
- `client_profile`: one row with firm, sells, fee_avg, voice, default_recruiter, signature.
- `compositions`: one row per compose attempt (`drafted`, `failed`, `raced`), linked to the enrollment it drafted. Approval lives on the messages (`approved_by` gains `client`).
- `handoffs`: reply message id, recruiter, forward Message-ID, forwarded_at, meeting_booked_at.
- `crm_contacts` (R5): every CRM row whole, with owner, status and dates. Replaces the planned `people.owner` / `last_contacted_at`: those are per CRM record, not per person, and a person can appear twice.
- `people.origin` gains `crm`; `contact_candidates.evidence` gains `crm`.

Main database only: `clients` (id, name, database, accounts JSON, caps JSON, portal_emails, demo, created_at). Step 7 replaced `caps` with `products` JSON (R21).

## Build order

1. Client registry, per-client database, `wren clients add|list`, `--client` on the CLI, pool cache. **Done.**
2. CRM formats and health: `wren --client <id> crm formats|import|verify|health`. Health exits 1 while the gate is shut. **Done.**
3. Findings and person lookup (R7) through the `web` and `linkedin` sites, plus `crm run|status`, the `wren` skill and the layer lint rule (R20). **Done.**
4. Company signals (R8), the watch (R19), briefs (R9), plus scoring (R10). The watch waits on autobrowse's watch mode, so the other three can land first. **Done except the watch.** `crm run` is now verify, lookup, signals, score, brief; `crm top` prints the ranked list.
5. Demo seed (R16): `wren --client demo crm seed-demo --agency <url>`. **Built.** The first real agency's site names 24 customers, under R16's 30.
6. Portal API and web (R14, R15), deploy, `demo.` and `app.` hosts. **Built;** `app.` waits on Access.
7. Composer (R11), the client dimension in the worker (R4), per-client settings (R21), sending (R12) and handoff (R13). **Done.** 7a settings and profile, 7b+7c composer and portal writes, 7d the per-client loop and client mailbox loops, 7e forwarding.
8. Offer `reactivation` (R18), lander `/demo` link, map cards. **Offer and map done.** The pilot is retired; the lander switches to `reactivation` in its own session (schema gets the `performance` kind, snapshot re-exported). `/demo` links once the demo is live.

## Owed by others

- autobrowse (asked 2026-09-29). Live by evening: LinkedIn people search, `/in/{vanity}?experience=true`, company page and jobs, per-account caps, Instagram Business Discovery. Built, not proven: `web` search and read, X by username. Per-account pacing landed in 923c287; lower caps on `linkedin` (40 profiles, 15 searches, 40 company reads a day) in 0979d8f, not yet deployed to the box. Still owed:
  - watch mode (R19): follow a person or page per account, X private List add, read the feed from a cursor
  - scroll-collect: scroll a feed or list and collect items as they load, until a cursor or a count
  - `extract`: read text, links, images and structured items out of a page (no full-page dumps)
- William:
  - X read spend grant
  - Cloudflare Access on `app.` (dashboard, `deploy/portal.md`), then the `PORTAL_ACCESS_*` secrets
  - consent language in the client contract for sending in the recruiter's name

## Where to attack

1. **Matching the wrong person** (R7). A common name at a big company resolves to a stranger, and the brief cites a real page about the wrong person. The name-plus-employer rule is the only guard; measure false matches on the demo list by hand.
2. **LinkedIn bans the research account.** For now that account is William's own profile, so a ban costs him his LinkedIn. Caps are guesses, kept low. Watch for challenge pages; the first one pauses the account for the day. Following hundreds of people from a fresh account is its own flag, so follows are capped and spread over days (R19).
3. **Demo masking leaks** (R15). One API path that forgets to mask exposes real people. Masking lives in one function every demo response passes through, with a test that walks every route.
4. **Pool pressure** (R3). N clients × worker instances × 2 connections. Count before client 5.
5. **Simulated CRM history** (R16) must never read as real. Banner plus a column label.
6. **Sender reputation per client** (R12). New domains, new mailboxes, 10-day warmup. A bad list burns a client's domains, not Wren's; the health report's dead-email count gates sending (over 10% invalid means clean first).

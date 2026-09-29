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
| `apps/portal` | new | `api/` (Lambda, read-only) + `web/` (React SPA on Cloudflare Pages) |
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
- **R4. The worker gains a client dimension.** Loop objects are keyed `<client>/<niche>` for client work, and `buildServices` resolves the handle per key from a cache. Wren's own loops keep their keys, so nothing live changes.
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
- **R19. Watch by following, read the feed.** Searching per person per day costs one request per contact per platform and looks like a scraper. Following costs one request per contact, once, and the daily read is one feed per account.
  1. Handles are resolved once, during lookup (R7): the LinkedIn profile, the X handle and the Instagram handle when a result names them. Company pages too.
  2. Subscribe:
     - X: a private List per client. Members get no notification, and the List timeline is one read.
     - LinkedIn: follow company pages (nobody is told). Follow people only when the client row allows it, since the person can see it.
     - Instagram: follow from the client's account, where it looks natural, or from the research account.
  3. Once a day per platform per account, read the feed from the saved cursor. Match each post's author to a watched person or company. Store the post in `documents` and a `post` or `hiring` finding.
  4. Follows are capped per account per day (about 20 to start) and spread over days. A new client's list fills its watch over two to three weeks. Search runs only for the one-time lookup and for news.
- **R9. Briefs are cited or dropped.** The LLM writes a brief from findings only. Each sentence carries `[f<id>]` marks, and a gate drops any sentence whose marks do not point at a finding for that contact (same idea as the reply classifier's quote gate). A brief with no surviving sentence is not stored. It goes through `complete_and_parse` and is a `runs` row with costs.
- **R10. Contacts are scored so the best go first.** Hiring at their company beats a job change to a new company. That beats still being there and recently in touch, which beats stale. The score's reasons are stored with it so the portal can say why.
- **R11. The composer writes as the client.** Input: the client's profile (firm, what they place, voice, the recruiter who knew the contact, signature) plus the brief. One email and one follow-up, lowercase subject, plain, per the cold-email SOP. The client approves the first batch in the portal before anything sends.
- **R12. Sending uses the existing machine.** Enrollments, pacing, roster and the Gmail transport, from domains we set up for the client (lookalike domains, mailboxes in the recruiter's name with written consent), warmed about 10 days. Never from the client's own domain.
- **R13. Replies go to the client.** Inbox sync plus the classifier. An `interested` reply is forwarded to the recruiter named on the contact (else the client's default), shows in the portal and pings the client. "Meeting booked" is marked by the recruiter in the portal or by us, and it's the billing unit.
- **R14. Portal: read-only API on Lambda, SPA on Cloudflare Pages, Cloudflare Access login.**
  - Access gives email-code login with no passwords, free to 50 users. The API checks the Access JWT, maps the email to a client through `clients.portal_emails`, and opens that client's database read-only (a `portal_ro` role per database).
  - The only writes are "approve batch" and "mark meeting booked", through Restate like the CLI's writes.
  - React + Vite, like autobrowse's `ui/`. Pages:
    - **Overview:** reached, replies, meetings, pipeline $
    - **Health:** the report
    - **People:** a table with job changes and hiring flags; the brief with its sources opens on click
    - **Replies**
    - **Emails:** the batch to approve
    - **Raw:** every finding with its source, per platform
- **R15. The demo is client `demo` with `demo: true`.** The API strips unmasked people fields before they leave the server (`Sarah K.`, `s•••@domain`), serves without Access, and refuses writes. Company names and sources stay real. A banner says what's real and what's simulated.
- **R16. The sample firm comes from a real agency's public data, kept anonymous.**
  - Pick a real recruiting agency of 10–50 people whose site names at least 30 clients (logos, case studies, testimonials).
  - Extract those names with the existing extraction, resolve their domains and find 1–3 hiring-side contacts per company through R7.
  - Write it as a Bullhorn-style CSV with simulated CRM history (last placement, last contact, owner) and realistic mess: duplicates, dead emails, blank titles.
  - Import it through the same path as a real client, so the demo exercises the product.
  - The agency is never named ("a 30-person tech recruiting firm, built from its public website"). No emails are ever sent to demo contacts: the demo client has no roster.
- **R17. Accounts are per client.** The `clients` row names each site's account, and wren always passes `account` explicitly. autobrowse enforces caps per account.
  - For now every client uses `linkedin`: William's personal profile, read-only. Its caps are lower than the default (40 profiles and 15 searches a day, asked 2026-09-29).
  - Clients sharing an account split one daily cap, and `clients add|set` warns when that happens. Give a client its own account (`linkedin@<client>`) once volume needs it.
- **R18. Offer.** `reactivation` is a `performance` price: `upfront` $1,000, `perUnit` $500, `unit` "meeting booked", `cap` $15,000. Prices stay off the lander (D14); the portal shows the running bill to the client.
- **R20. One command per job: `crm run` and `crm status`, plus the `wren` skill.**
  - `crm run` does every stage that is due, in order (`CRM_STAGES`: verify, then lookup). It stops at the first stage that aborts, is recorded as one `runs` row, and resumes when run again.
  - `crm status` says where the client stands and ends with one `next:` line.
  - Later stages (signals, watch, briefs, score) join `CRM_STAGES`, so the commands never change. The single-stage commands stay for debugging.
- **R21. Per-client differences are settings, not forks.** `clients.products` is JSON keyed by product: `{ reactivation: { … } }`.
  - Each product parses its own block with a schema and owns the defaults. A bad block fails at `clients set`, not in a loop at 3am.
  - The reactivation block covers:
    - stages on or off (lookup, watch, briefs, compose, send)
    - daily caps (lookups, follows, sends)
    - the sender domains and mailboxes
    - the offer terms
  - The firm's own details (voice, recruiters, signature) live in the client's database (`client_profile`), because only that client's work reads them.
  - The worker walks every client whose block turns the product on (R4).
  - This replaces `clients.caps`, which nothing reads. It gets built in step 7, when the worker first needs it.

## Data added (one migration, every database)

- `findings` (R6), indexed by person and by company.
- `watches` (R19): platform, account, subject person or company, handle, state (`pending`, `following`, `failed`, `dropped`), followed_at; plus one cursor row per platform and account for the feed read.
- `briefs`: person_id, text, citations JSON (finding ids), model, prompt_version, run_id.
- `contact_scores`: person_id, score, reasons JSON, computed_at.
- `client_profile`: one row with firm, sells, fee_avg, voice, default_recruiter, signature.
- `handoffs`: reply message id, recruiter, forwarded_at, meeting_booked_at.
- `crm_contacts` (R5): every CRM row whole, with owner, status and dates. Replaces the planned `people.owner` / `last_contacted_at`: those are per CRM record, not per person, and a person can appear twice.
- `people.origin` gains `crm`; `contact_candidates.evidence` gains `crm`.

Main database only: `clients` (id, name, database, accounts JSON, caps JSON, portal_emails, demo, created_at). Step 7 replaces `caps` with `products` JSON (R21).

## Build order

1. Client registry, per-client database, `wren clients add|list`, `--client` on the CLI, pool cache. **Done.**
2. CRM formats and health: `wren --client <id> crm formats|import|verify|health`. Health exits 1 while the gate is shut. **Done.**
3. Findings and person lookup (R7) through the `web` and `linkedin` sites, plus `crm run|status`, the `wren` skill and the layer lint rule (R20). **Done.**
4. Company signals (R8), the watch (R19), briefs (R9), plus scoring (R10). The watch waits on autobrowse's watch mode, so the other three can land first.
5. Demo seed (R16): `wren clients seed-demo --agency <url>`.
6. Portal API and web (R14, R15), deploy, `demo.` and `app.` hosts.
7. Composer (R11), the client dimension in the worker (R4), per-client settings (R21), sending (R12) and handoff (R13).
8. Offer `reactivation` (R18), lander `/demo` link, map cards.

## Owed by others

- autobrowse (asked 2026-09-29). Live by evening: LinkedIn people search, `/in/{vanity}?experience=true`, company page and jobs, per-account caps, Instagram Business Discovery. Built, not proven: `web` search and read, X by username. Per-account pacing landed in 923c287. Still owed:
  - lower caps on `linkedin`: 40 profiles and 15 searches a day (R17)
  - watch mode (R19): follow a person or page per account, X private List add, read the feed from a cursor
  - scroll-collect: scroll a feed or list and collect items as they load, until a cursor or a count
  - `extract`: read text, links, images and structured items out of a page (no full-page dumps)
- William:
  - X read spend grant
  - Cloudflare Access on `app.` (dashboard)
  - consent language in the client contract for sending in the recruiter's name

## Where to attack

1. **Matching the wrong person** (R7). A common name at a big company resolves to a stranger, and the brief cites a real page about the wrong person. The name-plus-employer rule is the only guard; measure false matches on the demo list by hand.
2. **LinkedIn bans the research account.** For now that account is William's own profile, so a ban costs him his LinkedIn. Caps are guesses, kept low. Watch for challenge pages; the first one pauses the account for the day. Following hundreds of people from a fresh account is its own flag, so follows are capped and spread over days (R19).
3. **Demo masking leaks** (R15). One API path that forgets to mask exposes real people. Masking lives in one function every demo response passes through, with a test that walks every route.
4. **Pool pressure** (R3). N clients × worker instances × 2 connections. Count before client 5.
5. **Simulated CRM history** (R16) must never read as real. Banner plus a column label.
6. **Sender reputation per client** (R12). New domains, new mailboxes, 10-day warmup. A bad list burns a client's domains, not Wren's; the health report's dead-email count gates sending (over 10% invalid means clean first).

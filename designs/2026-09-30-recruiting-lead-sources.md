# Recruiting firm lead sources (2026-09-30)

Where to get 10,000 viable recruiting and staffing firm leads, and how to get them without spending money. Research only; nothing is built yet. No lead data in this doc.

## Answer first

- **A viable lead** is a firm in the size band, the owner (or CEO/MD) named, a deliverable email for that person, and the office phone.
- **The strict ICP is small.** In the US, about **3,300 firms** fit the band (Census, below). To reach 10,000, the list has to include the smaller firms (**~9,500 more in the US**) and then Canada and the UK. Smaller firms get the reactivation offer ($1k setup + $500 per meeting). The ICP firms get the bigger offer.
- **Seed the firms with Google Maps** (free, every listing has a phone) **and Data Axle through a public library card** (free, owner name, size, sales and phone). Both are bulk sources. Everything else only adds or sizes firms.
- **Get size and owner from the firm's own site first.** The recruiting niche already crawls team pages. Use LinkedIn only to size and confirm the top tier, at a slow daytime pace. Scraping LinkedIn overnight doesn't work: a real person doesn't browse all night, and at a safe pace one account covers ~100 firms a day.
- **Verify emails with mailifier**, our own prober. It costs nothing per check.
- **Phone numbers are for calls, not cold texts.** 10DLC approval covers only the warm SMS lane. US cold SMS stays unbuilt (PH-D3). Canadian numbers published on the firm's own site can take a CASL text, but that lane is off by default.
- **Pace:** at 10 senders × ~30 a day, 10,000 first emails take about 7 weeks of weekdays. Send the ICP tier first.

## Size of the market (US Census SUSB 2022, employer firms by yearly receipts)

| NAICS | Firms | Small | ICP band | Bigger |
|---|---|---|---|---|
| 561311 placement (perm) | 6,277 | $0.5–2.5M: 1,814 | $2.5–15M: 846 | 338 |
| 561312 executive search | 5,945 | $0.5–2.5M: 1,853 | $2.5–15M: 583 | 144 |
| 561320 temp help | 15,768 | $1–10M: 5,865 | $10–50M: 1,909 | 875 |
| **Total** | 27,990 | **9,532** | **3,338** | 1,357 |

Temp-help receipts include the temps' pay. Fees run about 20–30% of that, so $10–50M in billings is roughly $2–15M in fees. Source: `us_6digitnaics_rcptsize_2022.xlsx` on www2.census.gov. The Census API now needs a key; the flat file doesn't.

Not counted here: IT staffing firms filed under 5415 and healthcare staffing filed under 62xx. Both are real extra supply. Solo recruiters (no employees) are left out on purpose.

**What it takes to reach 10k:** say 60–70% of firms end up with a named owner and a deliverable email. Then the US small + ICP bands give about 8–9k, and Canada and the UK fill the rest.

## Sources, ranked

| # | Source | Gives | Scale | Phones | Cost | Risk | Use |
|---|---|---|---|---|---|---|---|
| 1 | **Google Maps** (`autobrowse maps`) | name, site, phone, category, rating, address | ~20k+ US firms have listings; test below | ~100% | free | Google may throttle the home IP when pushed; signed out, no account at stake | main seed; US, then CA/UK metros |
| 2 | **Data Axle Reference Solutions** via a public library card | name, site, phone, **exec name + title**, employees, sales volume, year founded, SIC | 44M US + 2.6M CA businesses; staffing SICs 7361/7363 | yes | free with a card | per-download record cap (repeatable, see FAQ); terms shown at login; own prospecting is the advertised use, resale is not | main seed with owners; sizes firms Maps can't |
| 3 | **Firm's own site** (existing discovery crawl, recruiting `crawlHints`) | team page → headcount of recruiters, owner name/title, published emails, ATS in use | every seeded site | sometimes | free | none | sizing + owner, default |
| 4 | **LinkedIn**: company search (industry Staffing & Recruiting, size 11–50 / 51–200, by state), `/company/<h>`, `/company/<h>/people?keywords=recruiter` | size bucket, HQ, site, recruiter count, owner | search: 10 firms per read, 1,000 per query (slice by state) | page phone sometimes | free | User Agreement bans automation (hiQ lost on contract); risk = the research account gets restricted | Tier A sizing; company search is a cheap seed too (build it) |
| 5 | **Networks** | NPAworldwide ~520 member firms (public directory, sites); MRINetwork 250+ owner-run offices | ~800 | via site | free | none | owner-led perm firms; good Tier A/B seed |
| 6 | **Award lists** | Inc 5000 (HR/staffing), Forbes best recruiting + temp staffing, ClearlyRated Best of Staffing, SIA fastest-growing | ~1–2k across years | no | free | none | "growing" signal; skews bigger |
| 7 | **ATS footprints** (Common Crawl index, one crawl) | firms with a hosted job board: Crelate 190, Zoho Recruit 186 (some in-house HR), Recruiterflow 169, CATS 146, Loxo 130, PCRecruiter 53, Vincere 32, Avionté 24 | ~1k per crawl; more over past crawls | no | free | none | seed extras; better as **ATS detection on seeded sites** ("your Loxo" in copy, proves they have years of clients in an ATS) |
| 8 | **State licence lists** | NYC Open Data: 238 active employment agencies, 235 with phone. NJ and IL keep lists (format not checked). Ontario: no public list found | hundreds | yes | free | none | small top-up |
| 9 | **DOL LCA disclosures** (H-1B) | employer phone, **POC name, title, email, phone** | FY2025 Q4 file: 205 firms coded 5613, all with POC email; ~half owner titles. IT staffing mostly files as 5415 | yes | free | none | small, but direct owner emails |
| 10 | **SBA PPP loan data** | name, address, NAICS, jobs reported, loan size | tens of thousands of 5613 loans | no | free | stale (2020–21) | size check by name+address match; not a seed |
| 11 | **Apollo** | people search + emails + mobiles | large | mobiles (credits) | free tier too small; paid ~$49–99/mo | ToS allows own use | William's spend; fills owner emails if mailifier misses |
| 12 | **Companies House (UK)** | every company with SIC 78100/78200/78300, directors by API | large | no | free | PECR (below) | UK fill |
| — | UW library (Hoovers, Mergent, Scott's) | rich | — | — | — | academic licence, non-commercial | **don't use** for Wren |
| — | Franchise branches (Express, PrideStaff…), national chains, RPOs, PEOs (561330) | — | — | — | — | the franchisor owns the tech and marketing | exclude; maybe test 50 franchisees later |

### Maps test (one metro, 2026-09-30)

Two searches in Columbus OH ("recruiting firm", "staffing agency"), depth 5, with site email visits:

- 58 places in 9.5 minutes, 49 distinct domains.
- Every place had a phone; 57 had a site; 13 had an email.
- About a quarter were chains or national firms.

One search per metro misses most firms, so the sweep has to go by suburb and by category ("executive search firm", "temp agency", "IT staffing", "healthcare staffing"). Rough estimate: ~1,500 searches for the US at ~3–5 minutes each, ~75–120 hours of unattended Docker time. Chains are dropped by data: a domain that shows up in 3 or more metros is a chain.

### Library access (checked)

- Burlington Public Library (Ontario) gives remote Data Axle access with a card: US + Canada.
- Toronto Public Library has Mergent Intellect and Scott's Canadian Business Directory.
- The KPL research list didn't render; check the Kitchener and Waterloo libraries first.
- A card elsewhere may need residency or a non-resident fee (William's spend).

## Pipeline to 10k

1. **Seed.** Run the Maps sweep (US metros, then CA/UK), plus the Data Axle exports (SIC 7361/7363, 3–99 employees), NPAworldwide, MRINetwork, award lists and NYC. Import with `--niche recruiting` and dedupe by domain.
2. **Drop** chains (a domain in 3+ metros), franchises, PEOs, RPOs, job boards and dead sites.
3. **Size.** Use Data Axle employees and sales, then the recruiter count on the team page, then the LinkedIn size bucket (Tier A only). Use domain age by RDAP as "years in business" when Data Axle doesn't have it.
4. **Owner.** Take the team page first, then the Data Axle exec, then LinkedIn `/people?keywords=owner OR founder OR president`, then the LCA POC.
5. **Email.** Use a published address, else a pattern guess verified by mailifier. Catch-all domains are sent later, at lower volume. Canada: published addresses only (CASL).
6. **Tier** and pick the offer:

| Tier | Rule | Offer |
|---|---|---|
| A | 10–50 recruiters, or $2.5–15M perm / $10–50M temp billings | $10–15k + $5–10k/mo |
| B | 3–9 recruiters, or $0.5–2.5M perm / $1–10M temp | reactivation, $1k + $500/meeting |
| C | Canada and UK, A or B by the same rules | same as their size |

7. **Phones:** store the office line for the dialer. Run a line-type lookup and a DNC scrub before anyone calls a mobile (phone doc).

## LinkedIn pacing

- **Daytime only**, in the account's time zone: spread through the working day, weekday-heavy, and stop at the first 429 (`caps.ts`). Overnight marathons look least like a person.
- **Budget:** ~150–250 reads a day on the research account. A search page reads 10 firms, so seeding is cheap. Sizing costs ~2 reads per firm, so ~100 firms a day and ~3k Tier A firms in a month.
- **Read only.** No connect, message or follow without William's yes.
- **The account at stake is the research account, never Wren's posting account.**

## Compliance

- **US email: CAN-SPAM.** A real sender, a postal address, one-click opt-out, no fake subject lines. Pattern-guessed addresses are legal.
- **Canada email: CASL.** Implied consent only covers an address published conspicuously for the person's role, with no "no marketing" note. Keep the source URL (`provenance.address` already does). **Don't send to guessed Canadian addresses.**
- **UK email: PECR.** Corporate subscribers (Ltd, LLP) can be emailed with an opt-out. Sole traders and English partnerships need consent, so skip them. Keep a short legitimate-interest note.
- **Calls:** the phone doc's rules apply (quiet hours, no AI voice, DNC on mobiles, recording notice).
- **SMS:** US cold is not built (PH-D3). The Canada lane uses published business numbers only and is behind `WREN_SMS_CA_COLD=1`.
- **Data Axle:** follow the library's terms. Use the data for our own outreach only; never resell it or put it in git.

## Decisions

- **RL-D1** 10k needs Tier B and Canada/UK. The US strict band is ~3.3k firms.
- **RL-D2** Maps and Data Axle are the two seeds. Everything else adds or sizes.
- **RL-D3** Size from the firm's own site first. LinkedIn sizes only Tier A, at a daytime pace, read only. No overnight scraping.
- **RL-D4** Emails are verified by mailifier. No paid verifier (the MillionVerifier policy stands). Apollo only if William pays for it.
- **RL-D5** Numbers are for calls. No US cold SMS.
- **RL-D6** University library data is not used (academic licence).
- **RL-D7** Chain detection is data-driven (a domain in 3+ metros). No hand-kept list, so it works for any niche.

## Build (next, in order)

1. A **Maps sweep**: a plan file of metro × category searches, run nightly on the Mac with `--no-email` and resumable per search (run durability). It is niche-agnostic, with chain detection at import.
2. A **Data Axle flow** in autobrowse (search, then paged download at the library's cap, at a human pace), plus a `data-axle` import format in wren.
3. **ATS detection and domain age** in the site crawl.
4. A **LinkedIn company search route** (`GET /search/results/companies` with industry, size and geo) and a **recruiter count** from `/people`.
5. **Tiering** in the recruiting niche, with an offer per tier.

## Owed by William

- A library card with Data Axle: Kitchener/Waterloo first, else Burlington or Toronto (a non-resident fee would be his spend). He accepts the terms at login.
- Yes or no on Apollo paid, and on more senders to go faster.
- Confirm the tiers and the offer per tier.

## Where to attack

- Census counts employer firms, and the fee ratio for temp firms is an assumption.
- The Maps estimate comes from one metro.
- LinkedIn size is self-reported and counts contractors.
- Data Axle's staffing count and the library download cap weren't seen (no card yet).
- 10k leads make a sale likely, not certain. At a 0.5–1% positive reply rate that's 50–100 conversations. Copy and deliverability decide the rest.

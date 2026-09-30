# Recruiting firm lead sources (2026-09-30)

Where to get 10,000 viable recruiting and staffing firm leads for free, in the US and Canada. No lead data in this doc.

Revised the same day on William's rules: **no Apollo** (everyone uses it), **US and maybe Canada, no UK**, **keep every field a source gives**, and **one personalized opening line per email**.

## Answer first

- **A viable lead** is a firm in the size band, the owner named, a deliverable email for that person, and the office phone.
- **10k is reachable from free public data.** Two bulk sources give ~25k distinct firms:
  - **Overture Maps places**: ~18.8k US + ~2.2k Canadian firm domains, not chains, 97% with a phone.
  - **SBA Small Business Search**: 5,932 US staffing firms, every one with a named contact, 84% with an email.
  - They overlap by only ~870 domains.
- **Size comes from PPP loan data** (jobs reported, loan size) and the firm's own site.
- **Owners come from the firm's site crawl** (team pages), SBA contacts and principals, and LinkedIn for the top tier.
- **Data Axle is dropped for now.** The one library that gives it to non-residents (Burlington, Ontario) wants $66/yr paid by phone. William: use it only if free, so skip it.
- **Each email gets a one-line opener**, written by an LLM from facts we hold and quoted from the firm's own site or record. No quote, no line.
- **Measured (local import, 2026-09-30):** 32,955 firms, 23,414 with a site, 11,822 leads with an email before the crawl. PPP sizes 4,147 of them; 1,198 report 10–50 jobs.
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

**What it takes to reach 10k:** the free sources below hold ~25k distinct US + Canada firms. If half end up with a named owner and a deliverable email, that's ~12k.

## Sources, ranked

| # | Source | Gives | Scale (US + CA) | Cost | Use |
|---|---|---|---|---|---|
| 1 | **Overture Maps places** (S3, release 2026-09-23.0, CDLA-Permissive) | name, every site/email/phone/social, address, category, confidence, open/closed, source ids | 53k places tagged `employment_agency` or `temp_agency`; 21k non-chain domains; 8.2k with no site | free | main seed |
| 2 | **SBA Small Business Search** (`search.certifications.sba.gov`) | legal + DBA name, **contact person + email + phone**, site, address, year founded, principals, capabilities narrative, all NAICS, certifications, UEI, CAGE | 5,932 staffing-primary firms (US only); 15.8k more list a staffing code second (mostly IT and consulting) | free | seed with owners; the secondary list is IT staffing supply |
| 3 | **Firm's own site** (discovery crawl, recruiting `crawlHints`) | team page → owner, recruiter count; published emails; specialties; ATS in use | every seeded site | free | owner, size, opener evidence |
| 4 | **PPP loans** (SBA FOIA CSVs) | jobs reported, loan size (≈ 2.5 months of payroll), franchise name, business age | tens of thousands of 5613 loans, 2020–21 | free | sizing and franchise drop; not a seed |
| 5 | **Google Maps** (`autobrowse maps`) | same as Overture plus rating | ~100% phones | free | top-up where Overture has no site |
| 6 | **DOL LCA disclosures** | POC name, title, email, phone | ~205 firms coded 5613 | free | small, direct owner emails |
| 7 | **Networks, award lists, NYC licence list** | firms, sites | ~2k | free | Tier A seeds, "growing" signal |
| 8 | **LinkedIn** (research account) | size bucket, recruiter count, owner | ~100 firms a day | free | Tier A sizing only, daytime, read only |
| — | Data Axle via Burlington PL | exec name, employees, sales | 44M US + 2.6M CA | $66/yr, pay by phone | dropped for now (not free) |
| — | Apollo | people + emails | large | paid | **not used** (William) |
| — | UW library (Hoovers, Mergent) | rich | — | academic licence | **don't use** |
| — | Chains, franchises, PEOs (561330), RPOs, job boards, state workforce offices, military recruiting | — | — | — | drop |

### Overture (checked 2026-09-30)

- The category is in `taxonomy.primary`, not `basic_category` (that's just `professional_service`).
- US + CA, not closed: 49.4k US and 3.6k CA places; 85% have a site, 97% a phone, 24% an email.
- Domains by place count, US: 16,964 at one place, 1,839 at two, 1,513 at three or more (chains). Canada: 2,055 / 176 / 102.
- Noise the chain rule doesn't catch: `.gov` workforce offices, `linkedin.com` pages, one-off military pages (`marines.com` subdomains, state National Guard sites).
- Read with DuckDB over anonymous S3 in us-west-2, filtered on the bbox first. The North America pull took a few minutes.

### SBA Small Business Search (checked 2026-09-30)

- `POST /_api/v2/search` with the page's full filter body. NAICS go in as `{value, label}` objects with `operatorType: "Or"`. Results come back unpaged, so ask one NAICS code at a time (561320 alone is ~76 MB).
- The state filter didn't take any shape I tried. Not needed.
- Staffing-primary firms: 561320 temp 3,683, 561311 perm 1,942, 561312 exec search 307 (561330 PEO 130, dropped).
- Fill rates: contact 100%, email 84% (all with `display_email` true), phone 84%, site 59%, principals 24%, narrative 24%. Revenue and size are empty.
- Email: 2,383 on the firm's own domain, 1,290 on free mail.
- These are firms registered to sell to government. Many are small and owner-run.

### Library access (checked)

- Burlington PL gives remote Data Axle (US + Canada) to non-residents for $66/yr, paid by phone. Edmonton PL has none. Calgary PL is Canada-only and residents-only.

## Keep everything

Every source row is stored whole: `companies.raw` and `sightings.raw` keep every field, including the ones no column uses. A field is never dropped because it doesn't fit a key.

- **Overture:** all websites, emails, phones, socials, the full address, category and alternates, confidence, operating status, brand, the source datasets and their ids.
- **SBA:** every field the search returns, plus the contact as a lead (name + email) when there's an email.
- **PPP:** attached to the matched company as size facts: jobs reported, loan and forgiveness amounts, business age, franchise name, NAICS.
- **Crawl:** pages kept in `documents`; people, emails and titles through the existing extraction.

## The opener line

One sentence at the top of the email, about the firm, true, and checkable.

- **Input (v1):** the firm's crawled pages, homepage and about first, up to 10k characters. Firms with no crawled page get no line yet. *(v2: the SBA narrative for firms with no site.)*
- **Output:** `{line, quote, source_url}`. The line is at most 25 words and speaks to the firm, not about us.
- **Evidence-bound:** the quote must appear word for word on a page, every number in the line must be in the quote, and every capitalized name must be a word on the pages or the firm's name. No dashes, `!` or `?`, one line. Otherwise there is no line, and the reason is stored.
- **Stored** in `enrichments` (kind `opener`, per company, model and prompt version), so a re-run only pays for new firms.
- **Used** in templates as `(({company.opener}))` through `recruiting_facts`: no line, the paragraph drops.
- **Run:** `Enrichment/recruiting/opener` (Restate), `{limit, shard}`. Not in the pool: every run is a spend.
- **Cost:** prod runs Cohere Command A (~$2.50/M in, $10/M out). Measured on a 60-firm sample: ~2k tokens in, ~74 out, ~$0.006 a firm, so ~$70 for 12k. 29 lines from 42 firms with pages; the rest were rejected by the grounding checks. The full run is William's call.

## Pipeline to 10k

1. **Seed.** `wren fetch get overture-places` and `wren fetch get sba-search`, then import both with `--niche recruiting`. Dedupe is by domain.
2. **Drop** chains (recruiting: a domain at 11+ places; 3–10 is a regional firm), closed places, PEOs, franchises (PPP `FranchiseName`), `.gov`/`.mil` and platform domains.
3. **Size.** PPP jobs and loan size by name + ZIP, then the recruiter count on the team page, then LinkedIn (Tier A only).
4. **Owner.** Take the SBA contact or principal first, then the team page, then LinkedIn, then the LCA POC.
5. **Email.** Use a published address, else a pattern guess verified by mailifier. Catch-all domains are sent later, at lower volume. Canada: published addresses only (CASL).
6. **Opener.** Run the opener pass on firms with a deliverable email.
7. **Tier** and pick the offer:

| Tier | Rule | Offer |
|---|---|---|
| A | 10–50 staff, or $2.5–15M perm / $10–50M temp billings | $10–15k + $5–10k/mo |
| B | 3–9 staff, or $0.5–2.5M perm / $1–10M temp | reactivation, $1k + $500/meeting |
| C | Canada, A or B by the same rules | same as their size |

PPP loan size ≈ 2.5 months of payroll, so yearly payroll ≈ 4.8 × loan. For a perm firm payroll is most of the cost, so it's a fair floor on revenue.

8. **Phones:** store the office line for the dialer. Run a line-type lookup and a DNC scrub before anyone calls a mobile (phone doc).

## LinkedIn pacing

- **Daytime only**, in the account's time zone, weekday-heavy. Stop at the first 429 (`caps.ts`). No overnight scraping.
- **Budget:** ~150–250 reads a day, ~2 per firm, so ~100 Tier A firms a day.
- **Read only.** No connect, message or follow without William's yes. The research account only, never Wren's posting account.

## Compliance

- **US email: CAN-SPAM.** A real sender, a postal address, one-click opt-out, no fake subject lines. Pattern-guessed addresses are legal.
- **Canada email: CASL.** Implied consent covers only an address published conspicuously for the person's role, with no "no marketing" note. Keep the source URL (`provenance.address` does). **Don't send to guessed Canadian addresses.**
- **UK: out** (William, 2026-09-30).
- **Calls:** the phone doc's rules apply (quiet hours, no AI voice, DNC on mobiles, recording notice).
- **SMS:** US cold is not built (PH-D3). The Canada lane uses published business numbers only and is behind `WREN_SMS_CA_COLD=1`.
- **SBA contact data** is public (firms choose to display it). Use it for our own outreach only; lead data never goes in git.

## Decisions

- **RL-D1** 10k needs Tier B and Canada. The US strict band is ~3.3k firms. *(Revised: UK dropped.)*
- **RL-D2** Overture places and SBA search are the two seeds. Everything else adds or sizes. *(Revised: was Maps + Data Axle.)*
- **RL-D3** Size from PPP and the firm's own site first. LinkedIn sizes only Tier A, at a daytime pace, read only.
- **RL-D4** Emails are verified by mailifier. No paid verifier. **No Apollo, paid or free** (William).
- **RL-D5** Numbers are for calls. No US cold SMS.
- **RL-D6** University library data is not used (academic licence).
- **RL-D7** Chain detection is data-driven (a domain at N+ places). No hand-kept list, so it works for any niche. Core's default is 3; recruiting uses 11, which keeps 1,303 regional firms with 3–10 offices.
- **RL-D8** US and Canada only. No UK (William).
- **RL-D9** Every field a source gives is stored. The raw row is the record; columns are views on it.
- **RL-D10** The opener is evidence-bound: a word-for-word quote or no line.
- **RL-D11** Overture and SBA are niche-agnostic datasets and formats in core. A niche registers its categories, NAICS codes and countries.
- **RL-D12** Data Axle waits on William's card. Nothing depends on it. *(Revised 2026-09-30: dropped for now. William takes it only if free, and it costs $66/yr.)*
- **RL-D13** Prod's LLM (Cohere Command A) writes the opener. No second provider for one pass.
- **RL-D14** Opener v1 reads crawled pages only. The SBA narrative feeds v2, for firms with no site.

## Build

1. ~~**Overture places**~~: built. `wren fetch get overture-staffing`, `import --format overture-staffing`. Declines are counted by reason on the import.
2. ~~**SBA search**~~: built. `wren fetch get sba-staffing`, `import --format sba-staffing <dir>`. Firms whose primary NAICS isn't staffing are declined.
3. ~~**PPP sizing**~~: built. `wren fetch get ppp-staffing`, `wren email size <dir> --niche recruiting`. Matches by name + ZIP, or name + state when the state has one ZIP for that name.
4. ~~**Import to prod**~~: done 2026-09-30. Prod holds 34,023 recruiting firms (22,739 US, 1,172 CA, the rest from SBA with no country field), 24,466 with a site, 12,095 with an email lead (13,367 leads), 4,289 sized from PPP. The Overture import declined 13,908 chain, 2,521 closed, 1,704 nonprofit, 1,317 military and 574 public-body places. Next: the discovery crawl, when William arms the recruiting pool loop.
5. ~~**Opener pass**~~: built (kind `opener`, `recruiting_facts`, the opener template). Full run on William's yes.
6. **Tiering** in the recruiting niche, with an offer per tier.

## Owed by William

- Yes on the opener pass's full run (~$70 of LLM at Command A).
- Confirm the tiers and the offer per tier.

## Where to attack

- Census counts employer firms, and the fee ratio for temp firms is an assumption.
- Overture categories come from its sources; some firms are tagged `employment_agency` wrongly (workforce offices, law firms).
- SBA firms skew to government contractors. Their NAICS is self-reported.
- PPP is 2020–21 and self-reported. Name + ZIP matching misses firms that moved or renamed: locally it sized 13% of firms.
- LinkedIn size is self-reported and counts contractors.
- 10k leads make a sale likely, not certain. At a 0.5–1% positive reply rate that's 50–100 conversations. Copy and deliverability decide the rest.

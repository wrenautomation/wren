# Lead sheet: 13 columns, LinkedIn read without LinkedIn (2026-10-03)

## Answer first

- Every column comes from data we hold or from free or cheap reads.
- LinkedIn gets zero requests. Exa serves LinkedIn profile and company pages from its own cache, $0.001 a page (`source: cached`). No LinkedIn account and no request from our IPs ever reaches linkedin.com, so nothing can be flagged.
- Google finds profile URLs first: free, signed out, on the desk browser, capped. Exa's people search ($0.007) runs only when Google misses. Exa's cache reads whatever URL was found.
- Logged-in LinkedIn stays out. If William ever names a non-personal account, it fits in as the last leg for top leads, under autobrowse's existing caps.
- Cost: Exa's free $10 a month covers about 40 people a day, company included. Recruiting sends 10 a day, so enrichment runs just ahead of sends for $0. The whole backlog (11.5k people, about 10k firms) is about $120 once: William's call.

Both LinkedIn paths are rate limited on a logged-in account. Free accounts hit a monthly commercial-use limit on people search, and opening profiles by URL with no search before it is a bot pattern. Google plus Exa avoids both: LinkedIn sees nothing.

## Columns

| Column | Source | Cost |
|---|---|---|
| Person Name | `people.full_name` (registry, website); checked against the profile | $0 |
| Result Title | `people.title`; else the profile's current role at the firm | in the lookup |
| LinkedIn URL | `people.linkedin_url`, written by the lookup | $0 to $0.008 |
| Email | `leads.email` | $0 |
| Valid Email On | date of the newest verdict (`verifications.checked_at`) | $0 |
| Email Type | `person` (named mailbox) or `role` (info@, `isRoleLocalpart`) | $0 |
| Mail Status | valid → ok; risky, catch_all → risky; invalid → bad; none → unchecked | $0 |
| Company Name | `companies.name` | $0 |
| Company Domain | `companies.domain` | $0 |
| Company LinkedIn | `companies.linkedin_url` (new) | $0 to $0.007 |
| Company Location | the company page's Headquarters; else the import's address | $0.001 |
| Industry | the company page's Industry; else Overture category or NAICS | same read |
| Description | the company page's About; else the homepage meta description | same read |

## Person: find the profile

Cheapest first. Stop at the first trusted match.

1. **Held.** `people.linkedin_url`, or a linkedin.com/in/ link beside their name on the firm's own crawled pages (team pages). $0.
2. **Google.** `site:linkedin.com/in "First Last" "<company_short>"`. The title reads "Name - Title - Company | LinkedIn"; the snippet reads "Location · Title · Company". $0, capped.
3. **Exa people search** (`web GET /people`). Returns the profile text with every role. $0.007.
4. **Exa cache read** of a URL from step 1 or 2 (`web GET /linkedin/profile`): roles with dates, about, education. $0.001.

Trust rule is R7's (`lookUpPerson`): the name matches and a role is at the firm. A name match alone stays a candidate and is never written.

A current role at another firm is a `job_change` finding: the person left, so the address is stale. Registry contacts go stale often. Compose skips a person whose newest lookup says `job_change` or `left` at 0.8 or higher.

## Company: find and read the page

1. **URL.** The matched profile's current role `companyUrl` (free with the lookup). Else a linkedin.com/company/ link on the firm's crawled pages (footers). Else Google `site:linkedin.com/company "<name>"`. Else Exa company search by domain ($0.007).
2. **Read** through Exa's cache (`web GET /linkedin/company`): Industry, Headquarters, Founded, Homepage, size, About. $0.001.
3. **Trust** only when Homepage's registrable domain equals `companies.domain`. Exa merges look-alike firms into one entity (seen: a Portuguese agency carrying a US LLC's aliases). No match, no write.
4. **No page:** location from the import (Overture or SBA address), industry from Overture category or NAICS, description from the homepage meta description in `documents`. $0.

## What each service sees

- **LinkedIn:** nothing. Exa answers from its cache with `livecrawl: "never"`, so Exa does not fetch the page live either.
- **Google:** at most 200 signed-out searches a day from the Mac, paced 5 to 15 s with jitter, daytime only. The "sorry" page is handled (`pastSorry`). A CAPTCHA stops the Google leg for the day. The stage keeps going on Exa.
- **Exa:** API calls, metered in dollars, capped per day.
- Personal LinkedIn caps stay 0. No account logs in for this.

## Budget and pace

- **One Exa budget** in autobrowse, metered in mills ($0.001): people search 7, company search 7, cache read 1. Default cap 330 a day: $0.33 a day, about $10 a month, the free credit. A 429 from it parks the stage until the next UTC day.
- **Google:** the `web` site's cap is 300 a day, shared with other callers. This stage takes at most 200.
- **Throughput at $0:** about 40 people a day with company reads when Exa does the finding. More when Google or held links find them.
- A failed metered read is terminal, never retried (existing rule).

## Storage

Nothing read is dropped.

- `people.linkedin_url` (exists).
- `companies.linkedin_url` (new): canonical `https://www.linkedin.com/company/<handle>/`. This is the tracked URL.
- `documents` kind `profile`: the full cached text of each profile and company page. This is the personalization source.
- `findings`: person `still_there`, `job_change`, `left` (exist). New kind `profile` for companies: value `{industry, location, description, employees, founded, homepage}`, via `exa-cache`, `source_url` the LinkedIn URL.
- `person_lookups` (exists) and `company_lookups` (new, same shape): where each lookup stands, so a rerun skips finished rows.
- View `lead_sheet`: one row per lead with the 13 columns. `wren email sheet --niche <n> [--csv]` prints it.

## Order of work: just in time

- Pick people whose company is next to enroll: an ok address, best `role_rank`, the niche's queue order. Stay 7 days of sends ahead (recruiting today: 70 people).
- One stage, `profiles`, in the niche's PoolScheduler, journaled per person. The Google leg runs daytime only.
- `wren enrich profiles --niche <n> --limit N` runs it by hand.

## Personalization

The cached profile holds about, roles with tenure, and education. The company page holds About, founded and size. The opener stage can ground on these documents later (LLM spend: William's call). The grounding rule holds: a quoted line must appear in the document.

## Build

**wren** (one implementer once this doc lands):

1. Migration: `companies.linkedin_url`, `company_lookups`, `profile` in `FINDING_KINDS`.
2. `lookUpPerson`: the held-link step, the Google step, the cache read of found URLs. The logged-in step stays as is and off.
3. `research/companies/profile.ts`: find, read and confirm the company page.
4. The `profiles` pool stage and CLI.
5. `lead_sheet` view and `wren email sheet`.
6. Compose skips people a lookup says left.
7. `checkHiring`'s company-page step confirms through the cache read, so hiring checks stop needing a LinkedIn account.

**autobrowse** (landed c88a0ed, on the desk). All on site `web`:

- A. `GET /google`: Google's zero-result page (English) returns 200 with `results: []`. A sorry page or CAPTCHA still fails.
- B1. `GET /linkedin/profile?url=` (any LinkedIn host, `/in/<vanity>`) returns `{name, vanity, url, headline?, location?, connections?, about?, roles: [{title, company, companyUrl?, dates?, location?, current}], education: [{school, schoolUrl?, degree?, dates?, location?}], text, source}`. `url` is canonical `https://www.linkedin.com/in/<vanity>/`.
- B2. `GET /linkedin/company?url=` (`/company/<slug>`) returns `{name, handle, url, website?, phone?, industry?, size?, headquarters?, founded?, type?, employees?, about?, text, source}`. `url` is canonical `https://www.linkedin.com/company/<handle>/`.
- C. `GET /companies?domain=&n=` (n 1 to 10, default 3) returns `{domain, via, companies: [{...B2 fields without text and url, linkedin: <canonical url> | null, url, homepageMatches}]}`. Keep only `homepageMatches: true`.
- Optional fields are absent, never null.
- Errors are terminal, never retried. 400 is a bad url or domain (no meter). 404 means Exa has no copy. 429 means the `exa` cap is hit. 501 means no key. 502 means Exa failed or the page is not a profile or company.
- D. One `exa` bucket per UTC day: `/people` 7, `/companies` 7, `/linkedin/*` 1, cap 330. The facade meters before the call, so a 404 still spends 1 locally (Exa charges $0).

## Measured (2026-10-03)

12 random in-play recruiting people on prod, aggregate only:

- Exa people search: 7 name matches, 5 at the firm (42%). $0.084 total.
- Google site search: 3 name matches, 2 at the firm. 7 queries landed on Google's zero-result page, which the flow treats as an error (bug A).
- Exa cache: LinkedIn profile and company pages came back `cached`. A missing page is 404 `ENTITY_NOT_FOUND`, not charged.
- Prod: 11,465 in-play recruiting people, none with a LinkedIn URL. 33 of 33,202 firms carry a company LinkedIn link.

Expect 40 to 50% of contacts to have a findable profile. Owners of 1 to 5 person agencies often have none. Their rows keep our own title and firm fields.

## Owed by William

- Raise the Exa cap past the free credit to fill the backlog (about $120 once), or stay just in time at $0.
- A non-personal LinkedIn account, only if he ever wants logged-in reads. This design does not need one.

## Decision log

- Exa's cache over logged-out linkedin.com fetches: logged-out pages hit the authwall and HTTP 999 fast, and would put LinkedIn traffic on the Mac's IP. Exa costs $0.001 a page and LinkedIn sees nothing.
- Google before Exa search: free first. Exa search only on a miss.
- Just in time over the backlog: sends are 10 a day. Enriching 11.5k people now spends about $120 on people we will not email for months, and profiles go stale.
- No logged-in LinkedIn: personal reads paused (2026-10-01), and account creation is ruled out (reach design).
- Company pages need a Homepage match: Exa merges look-alike firms.

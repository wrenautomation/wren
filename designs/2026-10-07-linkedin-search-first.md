# LinkedIn research: search first (2026-10-07)

William, 10-07: "linkedin research can be google exa, but 20 on personal account is completely fine."

## Answer first

Every LinkedIn research read asks search before the account. Search means Exa and Google
`site:linkedin.com/...`. The account (`linkedin`, William's main) is the fallback, used only when
search came back empty or thin. It gets at most 20 reads a day across every kind. Each read is
metered by the source that served it, so the Vendors page shows two rows: "LinkedIn reads by
search" and "LinkedIn account reads". Research never likes, follows, connects or messages.

## The reads today

| Read | Code | Search today | Account today |
|---|---|---|---|
| A person's posts | collector `linkedin` (`signals/linkedin.ts`) | none | `GET /in/{vanity}/activity`, 10 a day |
| Profile basics | `profiles` stage, `lookUpPerson` step 5 (`people/lookup.ts`) | Exa cache, Google, Exa people | `GET /in/{vanity}` and people search, only when search left it open |
| A firm's jobs | collector `hiring`, `checkHiring` step 2 (`companies/hiring.ts`) | careers page and board API | `GET /company/{c}/jobs` |
| Company posts | none in research | | |

Company posts are read only by the comments watch, as `linkedin@wren`. That is reach, not
research, and not the personal account, so it stays as is. Reach discovery reads Reddit. Invites
send as the outreach account. Neither reads as `linkedin`.

## What changes

1. **Posts.** The collector asks Exa first, through a new autobrowse route `web GET
   /linkedin/posts`: an Exa search limited to `linkedin.com/posts`, with author, date and text.
   If Exa is thin, it runs Google `site:linkedin.com/posts/{vanity}`. A post counts only when its
   URL starts with `/posts/{vanity}_`. The urn comes from the URL (`activity-<id>`), and its date
   from the id: the top 41 bits are milliseconds. That date is `published`. When the id has no
   date, Exa's day is used as `approx`. The account read runs only when search found fewer than
   `enough` posts (default 2) in the last `recentDays` (90), and the account has room. An account
   cap no longer stops the pass, since search still answers. A subject with nothing found and a
   capped account is parked until the cap lifts.
2. **Profiles.** Already search first. Step 5 now asks the ledger for room. It makes at most that
   many account calls and counts them.
3. **Jobs.** Before the account, Google `site:linkedin.com/jobs/view "<firm>"`. Titles read
   "<Firm> hiring <Role> in <Place> | LinkedIn". Hits whose firm matches make a `hiring` finding
   via `google` (confidence 0.7, since indexed posts may be closed). No hit means thin, and the
   account is asked as before, if it has room.
4. **One cap of 20.** Two layers:
   - wren: vendor `linkedin` (account reads) gets a quota of 20 a day (burst 4), down from 10
     for activity alone. Every account read is gated on it and metered to it.
   - autobrowse: the `linkedin` account gets a total bucket, `reads: 20`. Every read route on the
     site spends one `reads` per call on top of its own kind. Per-kind caps stay as they are:
     profile 20, search 5, company 10, activity 10. This is the hard stop for any caller.
5. **Ledger.** One `vendor_usage` row per read. `linkedin` with units equal to the account calls
   when the account served it, else `linkedin_search` (new vendor, free, no quota) with 1. `part`
   is `signals.linkedin`, `signals.hiring` or `profiles`. The Vendors page lists both vendors
   with no UI change. The CLI meters too.

## Not done

- A Google leg for profiles. It already has one (step 3).
- Company-posts research. No research reads them today.
- Exa's dollars under the `exa` vendor. Search reads are counted under `linkedin_search` at $0:
  Exa runs on its free key ring, and autobrowse caps its mills a day per key.

## Prod

No env change. autobrowse must deploy for `/linkedin/posts` (desk auto-deploys on commit). Until
then, Exa answers 404 and the collector goes on to Google.

## Decision log

- 2026-10-07: Drafted from William's ask. Search first for posts, profiles and jobs. The account
  is the fallback, with 20 a day in total. The cap lives in both wren (vendor quota, so plans
  see room) and autobrowse (the account's own total, so no caller gets past it). Per-kind caps
  are unchanged. Two vendors, so the Vendors page shows the source with no UI work. The posts
  collector's bucket goes from 10 to 20 a day (burst 4): search reads are cheap, and the account
  share stays bounded by the shared 20.

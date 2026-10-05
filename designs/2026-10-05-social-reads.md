# Social reads: networks as enrichment and as lead sources (2026-10-05)

## Answer first

- Every network reads a firm two ways. **Enrichment:** we hold the firm and its handle, so we read its recent public posts and keep each as a dated fact with its link. **Source:** we search the network by niche, place or ad activity, and each hit becomes a firm, which then runs through the pool like any other.
- One reader per network serves both roles. A firm found by search is already enriched.
- **YouTube first.** About 4,100 firms on prod already have a YouTube link from their own site (contact points), so enrichment needs no search at all.
- **The hook.** A firm's newest post from the last 90 days becomes `post.*` facts for every niche's templates. A template uses it as one more `[[a | b]]` option in its first sentence, so the existing variant stats compare the hook with the plain opener. A firm with no fresh post never gets that option. Without a real post we don't write a hook.
- **Cost: $0.** It uses Wren's Google service account (already in prod) with read-only YouTube scope. That puts the reads in the `wrenautomation` project, which has its own 10,000 units a day, apart from the project that uploads Wren's videos. Calls go straight from the Lambda, so there is no Restate action per read.

## William's asks (2026-10-05, relayed by the lead-list session)

- Facebook, Instagram and YouTube reads for "legitimately personal" first sentences on existing leads.
- "finding niche leads that nobody else is looking for".
- Every network, LinkedIn too, as both enrichment and a lead source.
- Duplicate leads across lists are fine. Several hooks on one person can help, as long as the first impression isn't bad.

## YouTube

| Call | Units | Use |
|---|---|---|
| `channels.list` by id, handle or username, all 7 parts | 1 | the channel: title, about text, country, counts, keywords, topics, uploads playlist |
| `playlistItems.list` on uploads, 50 a page | 1 a page | the newest 50 uploads |
| `videos.list` on those ids, all parts | 1 per 50 | views, likes, comments, duration, tags, live details |
| `search.list` type channel | 100 | the source role, later |

- **Links:** `/channel/UC…`, `/@handle` and `/user/name` resolve in one call. A `/c/name` link has no lookup, so it is kept as a missing read (209 firms).
- **Kept as findings:** the channel is a `profile` finding (`via youtube`), and each upload is a `post` finding with its watch link. Each keeps the whole API resource as `raw`, and text is never cut. A link that leads to no channel is a `profile` finding marked missing, so the firm isn't read again for 30 days. A finding kept before `raw` counts as due again, so old reads fill in on their own.
- **Pacing:** a token bucket over the profile findings: 1,500 firms a day, burst 500, so at most 2,000 firms (6,000 units) in any 24 hours. The rest of the quota is kept for channel search. About 4,100 firms have a link and each is read every 30 days, so a steady day is about 140 firms. A pass waits for 100 firms of room, or a busy pool would read one firm a minute and never go idle.
- **Order:** firms with a lead we can still mail come first.
- **Where it runs:** `Enrichment/<niche>/youtube`, and the `youtube` stage in `PoolScheduler/<niche>`, which runs whenever the service account is set. Wren's niches only for now: the findings land on main.

## The hook

- `post.title`, `post.kind` (video), `post.site` (YouTube), `post.url` and `post.days` come from the newest `post` finding under 90 days old, skipping Shorts. They are merged in `factsFor` for every niche.
- The recruiting opener's first sentence gains an option: "I caught your recent video on <<…>>." The slot asks the model for the topic in a few casual words, from the title only. The slot check (one line, word cap, no new numbers) runs as for every fill. A refusal makes the option ineligible.
- Reply rates per option show in `wren email variants --niche recruiting`.

## Next, in order

1. **Exa niche search as a source:** people and companies by niche, title and city, on the shared Exa bucket.
2. **Meta Ad Library, logged out,** as a source: firms running ads in a niche now. The Ad Library API only covers political ads outside the EU, so it's a browser read. Built 2026-10-05 as autobrowse walk `fb-public/ad-library` (records op, `designs/2026-10-05-records-and-ai-steps.md` there): Library ID, advertiser, start date, ad text and call to action, 25 to 30 ads a keyword in about 9s with no model. Built 2026-10-05 as the `adLibrary` pool stage, below.
3. **Instagram `business_discovery`:** bio, site and recent captions of business accounts, officially. It needs our Instagram business account and app permissions.
4. **YouTube channel search** as a source, on the reserved units.
5. **Facebook groups**, below.

## Ad Library as a source

- **Read.** autobrowse `fb-public GET /ads?q=&country=US` runs the walk on the Mac (signed out, home IP). Each ad comes back whole: Library ID, advertiser, its page, start date, text, call to action, the link it sends to (unwrapped from `l.facebook.com`), every outbound link, the shown domain, and the card's whole text.
- **Firms.** Each read is one import of source `ad_library`, one row per ad. A firm is its ad's link domain (registrable, so `lp.` and `go.` hosts fold in). Forms, chats and funnel hosts (`leadconnectorhq.com`, `wa.me`, `typeform.com`...) don't count. An advertiser that never links home is keyed `fb:<page>`, so nothing is dropped. A firm already on file is seen again, never rewritten. A new firm keeps its first ad as `raw`, and every later ad is a sighting.
- **Keywords.** Each niche lists its own (`adKeywords`): 8 for recruiting, 8 for agencies, none for sec_ria. A keyword is read again after 7 days.
- **Pacing.** A bucket over the imports: 48 reads a day, burst 6. autobrowse also caps `fb-public` at 200 a day and spaces reads 20 to 40s apart. A read takes about 9s. $0.
- **Where it runs.** First in `PoolScheduler/<niche>`, so the same pass discovers and crawls the new firms; the niche's screen runs on them first. By hand: `Enrichment/<niche>/adLibrary`. It needs the Mac on; when it's off the stage fails fast and the rest of the pass goes on.
- **Not yet.** A firm first keyed by its page and later seen with a domain stays two firms. Merging them is a later pass.

## Facebook groups

Meta removed the Graph Groups API from every version on 2024-04-22, so no app can read a group through an API.

**What a logged-out browser sees** (checked 2026-10-05 on three recruiting groups, all private):

- A private group shows only its About panel: name, privacy, member count, posts today and in the last month, created date, admin rules. No posts, no members.
- A public group's posts are indexed by Google. Signed out, a public group's page shows its About and only the featured post, not the feed. A single post's page shows all of it: author (no profile link), badge, time, text, reaction and comment counts, and the top three or so comments (checked 2026-10-05 on three public staffing groups).

**Built 2026-10-05 in autobrowse, logged out, $0:** `fb-public GET /groups?q=` (Google, grouped by group), `GET /groups/{group}` (About), `GET /groups/{group}/posts/{post}` (a post and its top comments). Each read archives the page's HTML on the Mac. Step 3 became one walk per post found through Google, since the feed is not shown signed out. Step 4, storing reads in wren and turning posts into findings on firms, is not built: an author has no profile link signed out, so a post reaches a firm only through a link or a name in its text.

**Plan, logged out, $0:**

1. **Find groups** by Google search through the `web` site's `/google` route: `site:facebook.com/groups "<niche words>"`. The snippets carry post text for public groups.
2. **Read each group's About** with a records walk under `fb-public` (no login). Keep name, URL, description, privacy, member count, posts per month, created date and rules. Activity per month ranks groups worth watching.
3. **Read public posts** with a second records walk (a feed: `max` set, it scrolls). Keep post text, author name and profile link, time, reaction and comment counts, and links in the post. Where the login wall stops the feed is noted with the rows.
4. **Store everything.** Each read is kept whole as a document: rows plus the page HTML. When a post's author or link resolves to a firm, the post becomes a finding on that firm.

**Use:** a post by a firm owner asking for help is a lead signal. An author's profile link or a site in the post resolves to a firm through the usual pool.

**Open decision for William: a logged-in account.** Posts in private groups need a member account, and joining a group needs one too.
- Never Wren's Meta accounts (they run our ads) or William's personal one.
- A separate account made for reading risks a ban. Meta checks new accounts with no friends or history, and an account that only joins groups and scrolls reads as a scraper. Expect a checkpoint (phone or ID) within days, then a disable. Joining asks admins to approve, and many groups ask questions first.
- If it goes ahead, it should be one account made by hand on a real phone number, aged a few weeks with normal use before it reads, capped low (a few groups a day), and run on the desk's realistic Chrome. Until William says yes, groups stay logged out.

### Groups in wren: build brief (2026-10-05, peer ask relaying William)

Groups are a lead source and enrichment. Every group and post we read is wren data; a post that maps to a firm is also a finding on it.

- **Stage.** A `fbGroups` pool stage, Wren's niches only, after `adLibrary`. Each niche lists `groupKeywords` (recruiting: "staffing agency owners", "recruiting agency owners", "recruitment business owners", "healthcare staffing agency", "staffing business"; agencies: "marketing agency owners", "digital agency owners", "agency owners", "social media agency", "web design business"). Per due keyword: one `fb-public GET /groups?q=&n=20`, then the About of each group not read in 30 days, then each post Google showed that we don't hold. A keyword is due again after 7 days.
- **Pacing.** Two buckets, both over stored rows: 12 searches a day (burst 3) and 80 page reads a day (burst 10), About and posts together. The `adLibrary` stage's 48 reads plus these stay under autobrowse's 200 a day for `fb-public`. Each call is a `unit`, so the journal keeps every read. A 429 stops the pass, and a 4xx is kept as data, as in `ad-library.ts`.
- **Tables** (main, a new `packages/research/src/social-schema.ts` added to `packages/db/drizzle.config.ts`, since another session holds edits to `research/src/schema.ts`):
  - `social_groups`: network (`facebook`), ref (the id in the URL), niche, keyword, name, url, `about` jsonb (the About row whole, every field), `hit` jsonb (Google's result), `read_at`, `created_at`. Unique on (network, ref).
  - `social_posts`: network, group id (FK), ref, url, author, `posted` (as shown), text, `raw` jsonb (post row, comments, Google's hit), `company_id` and `person_id` (nullable FKs), `mapped_by` (`link` | `author` | `name` | null), `read_at`. Unique on (network, ref). An unmapped post is kept with its group, never dropped.
- **Mapping a post to a firm.** First, a link in the post (`links`, every out-link) whose registrable domain is a firm's `domain`. Second, the author's full name equals exactly one person we hold (first and last name, case-insensitive) in the niche, which gives that person and their firm. Third, a firm's name, of two or more words and unique in the niche, appears in the text as whole words. Otherwise unmapped. Mapping runs on new posts and again when a stage pass finds unmapped posts newer than 90 days, so new firms pick up old posts.
- **Findings.** A mapped post is a finding: kind `post`, via `facebook-group`, `fact_key` `fbgroup:post:<ref>`, the company and person, `source_url` the post's link. The value holds the group name and url, the author, text, as-shown time, counts, links and comments. It does not set `published_at`, so `postFacts` (the video hook) never picks it. Group-post facts for templates come later, with William's copy.
- **Out of scope.** Logged-in reads (William's open decision), hooks from group posts, a portal view.

### Exa niche search: build brief (2026-10-05)

Firms by niche and city from Exa's index, on the shared Exa allowance.

- **autobrowse.** `web GET /exa/companies?q=&n=` (n up to 25, default 10): Exa `/search` with `category: "company"`, every result whole (`raw`) plus url, title, and the registrable domain. Meter it in the `exa` mills cap at what Exa charges a search. Use the key ring like the other Exa routes (`src/reach/web.ts`).
- **wren.** An `exaSearch` pool stage, Wren's niches only: each niche lists `exaQueries` (recruiting: "staffing agency in {city}", "recruiting firm in {city}", "executive search firm in {city}"; agencies: "digital marketing agency in {city}", "web design agency in {city}"), crossed with a niche city list (the 25 largest US metros). One query is one call and one import of source `exa_search`, one row per result, `website` = its domain. Imports dedupe by domain, a known firm gets a sighting, and the niche's screen runs on new firms, as in `ad-library.ts`. A query is due again after 30 days. The bucket is 30 searches a day (burst 5), over the imports. A spent key ring (402) stops the pass. Cost: about $0.005 a search, so 30 a day is about $4.50 a month of the keys' free credits; a spent ring stops, never pays.
- **Instagram `business_discovery`** is not in this brief: it needs a check of which login our Instagram app uses, done in the main session.

## Rules

- Never read through Wren's own logged-in Meta or Instagram accounts, or William's personal ones. Those accounts run our ads, and Meta bans accounts that scrape. Use official APIs or logged-out reads only, of firm pages and channels, never a person's private profile.
- Free official APIs first. A browser only where no API exists.
- Store everything a source returns (every field, the raw response, the page HTML for a browser read) and filter when reading. Never drop data at write time to fit a schema.
- Dedupe identity, not reach. One person is one row, and every source that found them is a sighting. The send-time guard is what matters: no person in two active sequences, and no two first touches on one day.
- Every metered stage gets a bucket, and buckets share a network's allowance rather than each assuming the whole.

## Decision log

- 2026-10-05: YouTube first, enrichment before source. Service account over an API key: no new secret, own quota. Findings over a new table: the facts are what downstream reads.
- 2026-10-05: Store everything (William, via the lead-list session). YouTube asks for every part and keeps the raw resources. Uploads go 50 deep with videos.list stats, and old reads backfill on their own. That's 3 units a firm, so the bucket dropped to 2,000 firms a day. Every autobrowse answer that wren reads is kept whole as a document.
- 2026-10-05: Facebook groups (William: "make sure to add facebook group scraping too"). Meta removed the Groups API from all versions on 2024-04-22, so groups are logged-out browser reads for now. A logged-in reading account is William's call because of the ban risk above.
- 2026-10-05 trial: 105 recruiting firms read (210 units, $0). 22 had a non-Short upload in 90 days, 11 in 30. Three slot prompts on those 22 titles (≈ $0.10 of Cohere): asking for the phrase "after your recent video on" made the model echo it; asking for lowercase broke the word cap. The prompt that shipped gives one mid-sentence example and refuses anything not about work. 11 of 22 passed, and all of them read naturally; a refusal only drops the option.
- 2026-10-05: Ad Library advertisers become firms (`adLibrary` stage, peer ask relaying William). Domain first, page key only when there's no domain, every ad kept. The walk now keeps the link each ad sends to; the first version kept only the button label.
- 2026-10-05: Facebook group reads built under `fb-public`, logged out. Signed out, a group feed shows only the featured post, so posts come from Google's index, one walk per post.

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
| `channels.list` by id, handle or username | 1 | the channel: title, about text, country, counts, uploads playlist |
| `playlistItems.list` on uploads, 5 items | 1 | the newest uploads: title, description, date |
| `search.list` type channel | 100 | the source role, later |

- **Links:** `/channel/UC…`, `/@handle` and `/user/name` resolve in one call. A `/c/name` link has no lookup, so it is kept as a missing read (209 firms).
- **Kept as findings:** the channel is a `profile` finding (`via youtube`), and each upload is a `post` finding with its watch link. A link that leads to no channel is a `profile` finding marked missing, so the firm isn't read again for 30 days.
- **Pacing:** a token bucket over the profile findings: 2,000 firms a day, burst 1,000, so at most 3,000 firms (6,000 units) in any 24 hours. The rest of the quota is kept for channel search. A pass waits for 100 firms of room, or a busy pool would read one firm a minute and never go idle. A channel is read again after 30 days.
- **Order:** firms with a lead we can still mail come first.
- **Where it runs:** `Enrichment/<niche>/youtube`, and the `youtube` stage in `PoolScheduler/<niche>`, which runs whenever the service account is set. Wren's niches only for now: the findings land on main.

## The hook

- `post.title`, `post.kind` (video), `post.site` (YouTube), `post.url` and `post.days` come from the newest `post` finding under 90 days old, skipping Shorts. They are merged in `factsFor` for every niche.
- The recruiting opener's first sentence gains an option: "I caught your recent video on <<…>>." The slot asks the model for the topic in a few casual words, from the title only. The slot check (one line, word cap, no new numbers) runs as for every fill. A refusal makes the option ineligible.
- Reply rates per option show in `wren email variants --niche recruiting`.

## Next, in order

1. **Exa niche search as a source:** people and companies by niche, title and city, on the shared Exa bucket.
2. **Meta Ad Library, logged out,** as a source: firms running ads in a niche now. The Ad Library API only covers political ads outside the EU, so it's a browser read on the desk, paced.
3. **Instagram `business_discovery`:** bio, site and recent captions of business accounts, officially. It needs our Instagram business account and app permissions.
4. **YouTube channel search** as a source, on the reserved units.

## Rules

- Never read through Wren's own logged-in Meta or Instagram accounts, or William's personal ones. Those accounts run our ads, and Meta bans accounts that scrape. Use official APIs or logged-out reads only, of firm pages and channels, never a person's private profile.
- Free official APIs first. A browser only where no API exists.
- Dedupe identity, not reach. One person is one row, and every source that found them is a sighting. The send-time guard is what matters: no person in two active sequences, and no two first touches on one day.
- Every metered stage gets a bucket, and buckets share a network's allowance rather than each assuming the whole.

## Decision log

- 2026-10-05: YouTube first, enrichment before source. Service account over an API key: no new secret, own quota. Findings over a new table: the facts are what downstream reads.
- 2026-10-05 trial: 105 recruiting firms read (210 units, $0). 22 had a non-Short upload in 90 days, 11 in 30. Three slot prompts on those 22 titles (≈ $0.10 of Cohere): asking for the phrase "after your recent video on" made the model echo it; asking for lowercase broke the word cap. The prompt that shipped gives one mid-sentence example and refuses anything not about work. 11 of 22 passed, and all of them read naturally; a refusal only drops the option.

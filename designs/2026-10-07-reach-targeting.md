# LinkedIn reach targeting (2026-10-07)

The comments loop (`packages/outreach/src/linkedin-posts.ts`) found mostly the wrong posts. The fix keeps job ads out in code, ranks owners above vendors, and lets search words earn their place.

## Before

Prod had one pass: 67 posts from 4 search words. I labeled each by hand (labels stay off the repo):

| Search word | Posts | Buyers | Job posts | Vendors | Other |
|---|---|---|---|---|---|
| recruiting agency | 20 | 4 | 5 | 1 | 10 |
| staffing agency | 19 | 2 | 6 | 6 | 5 |
| lead follow-up | 9 | 0 | 0 | 7 | 2 |
| client reactivation | 19 | 0 | 5 | 14 | 0 |

So 6 of 67 were buyers. The two growth words found only vendors who sell to our buyers. The pass queued 10. The redraft dropped 9: 3 job ads, 2 off topic, 3 under fit 70 and 1 by the facts guard. The one left was a recruiting firm owner talking to students.

Replayed through main's code, the same 67 give a pool (fit 70 or more, not off) of 5: 2 buyers, 1 vendor, 2 off topic. Two job posts still pass.

## After

Same 67, new code: a pool of 4, with 3 buyers and 1 off topic. All 16 job posts are off. Buyers in the pool went from 40% to 75%. Of the old queue of 10, only the buyer post the facts guard dropped now reaches the pool.

Search words get measured live from the next pass on. `wren reach posts status` shows each word's yield.

## What changed

- Job posts. `jobPost(text, headline)` gives one of three reasons. A job ad: the old phrases, plus "interested candidates", "candidates must", "send their resumes", three or more field labels ("Location:", "Rate:"), shift and days-per-week lines, and "recruiting reliable/experienced". A job seeker: "you're recruiting for", "happy to interview", or a headline like "Open to work" or "Available for". For job seekers: "get you a job", "place you", or two career-advice cues (land a job, students, graduate, your CV). `isJobAd` is true for all three. Synthetic copies of the cases the model caught are in `src/reach-posts.test.ts`.
- Author fit. `authorFit(headline, audience)`. An owner title with an audience word in the headline is a buyer (+18). Any other owner gets +10, a manager +5 (+10 in the audience's world). A headline that sells ("I help", "helping", consultant, coach, advisor, fractional) gets -15. A buyer's post passes the audience gate even when the text never names the world.
- Post voice. The owner's own voice ("our recruiting agency", "my clients", "I started my firm") adds up to 10. A pitch ("book a call", "link in the comments", "join the waitlist") costs 8.
- Search words from research. New settings `about` (who the buyers are) and `newTopics` (default 3). Each pass reads every word's yield over 14 days (`topicYields`). His own words go best yield first. A word that read 15 posts with none on target rests until those reads age out. Past model words with 2 or more on target come back. The model proposes the rest from `about` and those yields (`proposeTopics`). Code drops any phrase with job words, over 5 words, or already known. Key people always get their reads.
- Audience. "agency owner" joins Wren's default words.

Everything targeting lives in each platform's settings block (`linkedin.comments`, `x.comments`, `instagram.comments`), with Wren's defaults. Nothing names a niche in code.

## 2026-10-09: the title filter, X and Instagram

- `authorTitle` (LinkedIn only): autobrowse's `postsSearchUrl` passes it as LinkedIn's
  `authorJobTitle` filter, so a search reads only authors whose title has the words ("founder").
- `companies` became `pages`: LinkedIn company handles, or X and Instagram usernames.
- X reads: recent search with `lang:en -filter:replies -filter:retweets since:<day>`, and an
  account's own posts (no reposts, no pinned post). Instagram reads: keyword search, then each
  post page (3 searches a pass, 6 posts each), and an account through Graph business discovery.
- Key people on X and Instagram: handles that touched us. LinkedIn keeps accepted invites and
  engagers.
- The model's search words and the comment prompt name the platform; each has its own length rule.

## 2026-10-25: supply under the day's ten

Prod made 1 to 4 comments a day against `perDay` 10. Every post at fit 70 or more got a draft, so supply was short. In 7 days, 267 of 372 dropped posts held none of the audience's words. Model topics ("firm growth challenges") kept 0 to 3 of 20. "recruiting agency" kept 23 of 139, but 60 of the 139 were job ads.

- Searches leave out job words: LinkedIn `NOT hiring NOT jobs NOT vacancy`, X `-hiring -jobs -vacancy`. A real read: 0 of 8 results held them.
- Model topics name the trade with an audience word. A topic without one is not used.
- LinkedIn post reads go from 12 to 40 a day. A pass runs every 6 hours until the day's comments wait.
- Key people are the people we invited (`enrolled`) and the people we connected with: 177, not 28. The draw changes each pass, so no one is read twice in a day.
- A key person's post is not dropped for missing the audience's words. We chose them by firm and title. Rank and the job-ad check still apply.
- Not used: the `authorTitle` filter. A real read with "founder" did not narrow the results.

Later the same day (William: every draft waits for his yes, cheap models for keyword work):

- A past model topic also must name the trade before a pass uses it again. "firm growth challenges" had 2 hits, so it came back each pass.
- "Recruitment Consultant" is the trade's own job title. It is staff (+5), not a vendor (−15). "Consultant to staffing firms" and "I help" still mark a seller.
- A boolean search (`"recruiting agency" (clients OR fees)`) hits on its first quoted phrase (`topicCore`).
- Reach calls that are not drafts (topics, ranking, place checks) go to `WREN_REACH_LLM`, default `anthropic:claude-haiku-5-5`. Before, they went to the Monitor's model, which is Sonnet on prod. Drafts keep `drafts.model`.

Then (William: fewest round trips, most data per action; a platform counts searches and page loads, not results):

- One search scrolls to the flow's most: LinkedIn 50 (was 20), X 100 (was 20), Instagram's grid 30 (was 6). Same actions, more posts.
- A plain multi-word topic searches as one quoted phrase. Unquoted, X matched the two words anywhere: party politics, government job news.
- X has few owner posts. A real 2-day read of nine owner-voice phrases found 2. A 7-day read of trade words with business words found 30, most from vendors. Rank put the best of a 21-post read at 55. `minFit` stays 70: under it the posts are not owners.
- Instagram never searched. Its 2 reads went to key people first, and all 25 kept posts came from one account. Now accounts read through Graph (an API call, no page load) take up to 8 a pass apart from searches. Searches take 1 a pass: 1 grid load and 6 post pages. That is 4 searches and 24 page loads a day.
- The grid's top posts run months old. A shortcode holds its time, so the 6 newest open and no load goes to a post we know is old. Their authors still count: an Instagram account whose kept post or bio names the trade joins key people and is read fresh through Graph.

## Not done

- No LinkedIn reads to test the new search words. They are measured on prod passes.
- Company posts carry no headline, so their author fit stays 0.

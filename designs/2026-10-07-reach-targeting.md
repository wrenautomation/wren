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

- Job posts. `jobPost(text, headline)` gives one of three reasons. A job ad: the old phrases, plus "interested candidates", "candidates must", "send their resumes", three or more field labels ("Location:", "Rate:"), shift and days-per-week lines, and "recruiting reliable/experienced". A job seeker: "you're recruiting for", "happy to interview", or a headline like "Open to work" or "Available for". For job seekers: "get you a job", "place you", or two career-advice cues (land a job, students, graduate, your CV). `isJobAd` is true for all three. Synthetic copies of the cases the model caught are in `src/linkedin-posts.test.ts`.
- Author fit. `authorFit(headline, audience)`. An owner title with an audience word in the headline is a buyer (+18). Any other owner gets +10, a manager +5 (+10 in the audience's world). A headline that sells ("I help", "helping", consultant, coach, advisor, fractional) gets -15. A buyer's post passes the audience gate even when the text never names the world.
- Post voice. The owner's own voice ("our recruiting agency", "my clients", "I started my firm") adds up to 10. A pitch ("book a call", "link in the comments", "join the waitlist") costs 8.
- Search words from research. New settings `about` (who the buyers are) and `newTopics` (default 3). Each pass reads every word's yield over 14 days (`topicYields`). His own words go best yield first. A word that read 15 posts with none on target rests until those reads age out. Past model words with 2 or more on target come back. The model proposes the rest from `about` and those yields (`proposeTopics`). Code drops any phrase with job words, over 5 words, or already known. Key people always get their reads.
- Audience. "agency owner" joins Wren's default words.

Everything targeting lives in the `linkedin.comments` settings block, with Wren's defaults. Nothing names a niche in code.

## Not done

- No LinkedIn reads to test the new search words. They are measured on prod passes.
- The author job title filter on LinkedIn's post search would need autobrowse's `postsSearchUrl` to change. Left for that repo.
- Company posts carry no headline, so their author fit stays 0.

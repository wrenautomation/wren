# Blog and newsletter

2026-10-11. William's temp note: "fully fleshed out email newsletter funneling into substack setup (or custom blog site with integrated animations and visuals)".

## Decision: our own blog, not Substack

- Posts live on wrenautomation.com, so search, the `/go/` and visitor tracking, replays and the booking button all work on them. Substack keeps the readers and the SEO on its domain.
- Substack has no posting API, so every post there would be a browser run.
- The opt-in plumbing was already built: double opt-in, proof per consent, the preference center, one-click unsubscribe, `mayMarket` (designs/2026-10-04-borrowed-ui.md). Only a sender was missing.
- Substack's network is the one thing we give up. Cross-posting there later is a browser job, not a rebuild.

## How it works

1. **Write.** One Markdown file per post in lander `src/content/blog/`. Its file name is the slug. `draft: true` builds in dev only. `how-to-post.md` is the template and stays a draft.
2. **Page.** `/blog` lists the posts, `/blog/<slug>` shows one, and `/blog/rss.xml` is the feed. Both pages carry the signup (topic `newsletter`, words versioned `blog-v1`). Motion follows the reader's scroll: a reading bar, and figures rise in once. CSS only, and off under reduced motion. The sitemap adds the blog once a post exists, and until then `/blog` is noindex.
3. **Email.** `/blog/<slug>.json` is the post as plain text. Links read "words (url)", and each image becomes a line to the page. The email is the post itself, so there is never a second copy to keep in step. It ends with a line to the page, then the footer `marketingEnvelope` gives it: preference link and postal address. It has the List-Unsubscribe headers.
4. **Send.**
   - `wren newsletter send <slug>` shows who gets it and why the rest don't. `--yes` hands it to the `Newsletter` object, keyed `<topic>:<slug>`.
   - Each confirmed consent passes `mayMarket` at its own send. The `sent` event's evidence names the issue, so a rerun skips anyone who already has it.
   - Sends go from portal@, one a second, at most 1,500 a day.
   - `--test <address>` sends to our own domain only, marked [test], and records nothing.
5. **Count.** `wren newsletter status <slug>`, and the console's `marketing.subscriber` and `marketing.topic` records.

## Before the first send

- `wren newsletter topic` makes the list. Until it exists, the lander's signup answers "no such list".
- `WREN_MARKETING_POSTAL` must be set. CAN-SPAM and CASL need a postal address on every marketing email, and until it is set the send refuses. A virtual mailbox works.
- The worker must be deployed with the `Newsletter` object.

## Not now

- HTML email. Plain text from a person reads as a letter and lands in the inbox. The pictures are on the page.
- Per-post animated components (MDX). Add `@astrojs/mdx` the first time a post needs a live diagram.
- Open tracking. Clicks already come back through the post's own visit tracking.

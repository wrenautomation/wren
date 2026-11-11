# Competitor ads: the Meta Ad Library as a Learn source

2026-11-11. WA-1256. William, 11-11: "a browser or hopefully API based workflow that we need to build immediately and probably wire up to weaver and also relates to canon as best winning ad references."

## Goal

Any competitor's running ads, read and broken down like a reel: hook, offer, voiceover, cuts, call to action. The long runners become Canon references for `meta-ads` and the content playbook. One command pulls an advertiser or a keyword; Weaver can ask for the same thing in a research run.

## Where the ads come from

- Meta's Ad Library API returns political and issue ads, plus ads that reached the EU (DSA). Most US commercial ads are not in it. API first does not hold here: the API exists, but not for this data.
- autobrowse's signed-out walk `fb-public GET /ads` reads the web Ad Library, which shows every active ad. Extended 11-11 (autobrowse 34722b9): `page` (id, URL or username) or `q`, `country`, `inactive`, `max`. Per ad: advertiser, `started`, `ended`, `daysRunning`, `platforms`, `versions` (ads that share the creative), `format`, copy, CTA, link, media (signed fbcdn URLs that expire), DPA cards, `raw` (the library record whole). Cap: 200 reads a day on the desk's `reads` bucket; one read is 30 ads.
- $0: a browser on the Mac.

## Options: where an ad lives

| Option | For | Against |
|---|---|---|
| A. A Learn item of kind `ad`, plus `learn.ads` (one row per ad: the numbers and `raw` whole) | the breakdown, findings, Canon promote and playbook all work on Learn items today; one more rubric | Learn gets a second table for one kind |
| B. Its own `research.ads` table and pipeline | ads apart from content | a second breakdown, a second promote: the drift the one-core rule forbids |
| C. Weaver ledger pages only | Weaver already keeps pages whole | no breakdown, no Canon path, no SQL over days running |

Ranked: one core for every breakdown, then keep every field, then upkeep. Chosen: A.

## Shape

- `learn.items`: kind `ad`. url `https://www.facebook.com/ads/library/?id=<libraryId>` (one ad, one item per workspace). Title `<advertiser>: <headline or first line>`. `text` is the copy (headline, body, CTA, link, cards). `media_url` is the video (hd, else sd); `thumbnail_url` the poster or first image.
- `learn.ads`: `item_id` (key), `client`, `library_id` (unique per client), `page_id`, `advertiser`, `active`, `started`, `ended`, `days_running`, `versions`, `platforms`, `format`, `raw` (jsonb, whole), `seen_at`. A pull again updates the numbers; `raw` is the last read.
- Read, at pull time on the Mac (the media links expire): a video ad through the watch core (frames, speech, cuts); an image or carousel through the eye, each image once. The page starts with an `## Ad` facts fence (format, days running, versions, platforms) so the breakdown's facts are code's, as a film's are.
- Breakdown rubric `ad`: the shared fields (hook style, hook, beats, CTA) plus the offer (free text) and its kind (discount, free-trial, lead-magnet, consult, product, other). Facts: format, days running, versions, platforms, active, speech (yes or no), cuts.
- Winner: active and running 30 days or more, or 3 or more versions. An advertiser keeps paying for what works; a long runner with many versions is the strongest public signal. Winners get the item tags `winning-ad` and `reference`, so `learn promote` writes them to Canon as references.

## Surfaces

- `wren learn ads (--page <page> | --q <words>) [--country US] [--inactive] [--max 30] [--no-read]`: pull, save, read, break down. JSON out.
- `wren learn ads --winners [--page <page>]`: the winners, longest running first.
- Weaver (weaver dev): a source that calls the same desk route in a run, so "what ads do staffing agencies run" is a research ask. The run's kept ads go to Learn through the same command.

## Non-goals

- Spend and reach: the library shows them for political ads only.
- A follow loop: Learn's feeds were cut 11-04. A competitor watched over time comes back as a Weaver output.

## Log

- 2026-11-11: option A chosen (above). autobrowse built the walk; wren side and the Weaver source follow.

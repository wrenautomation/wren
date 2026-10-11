# Comment keywords

2026-10-11. temp_notes: "steal their notification system" (OpenReply, an open-source ManyChat: comment a keyword, get a DM).

## Decision

- Marketing → Comment keywords. A keyword, its DM, an optional public reply, optional site and post. Someone comments it on our Instagram or Facebook post; the next SocialWatch pass sends the DM.
- DM through Meta's private reply (the DM door we have). One per comment, 7 days; one per person per keyword.
- Whole-word match, any case, accents off. Narrowest keyword wins.
- Marketing → Keyword DMs: the log, each hit sent or failed with Meta's reason.
- No approval step: the DM is his words, set once. Sends still pass the client's send switch (`Content.privateReply`).
- Clients get it the same way on their own database once their pages show it; the code takes a client.

## Not now

- Tracked links per keyword: put a `/go/` link in the DM.
- Instant send by webhook: SocialWatch's read cadence sets the delay.
- Other sites: X, LinkedIn, YouTube and TikTok have no DM from a comment.

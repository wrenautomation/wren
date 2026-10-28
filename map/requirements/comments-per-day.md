---
type: requirement
covers: ["@wren/outreach/src/reach-posts/settings.ts", "@wren/outreach/src/reach-posts/pass.ts", "@wren/outreach/src/reach-posts/draft.ts"]
---

# 10 comments a day on others' posts

William, 2026-10-07: "10 comments a day on others' posts", all gated for his approval (`designs/2026-10-07-posting-flow.md` item 4).

## Why

A comment in his voice on a buyer's post is reach that costs no ad money. His approval on each one keeps the voice his.

## Met by

- `settings.ts`: `perDay` 10 per platform; a platform is off until its block names an account.
- `pass.ts`: `postsPass` reads, ranks and keeps posts; `postsToDraft` picks up to `perDay`, fit ≥ `minFit`, one per author.
- `draft.ts`: `guardedComment` drafts in his voice and claims only Wren's facts. Each draft waits in To approve.
- Object: [[content/reach-post]].

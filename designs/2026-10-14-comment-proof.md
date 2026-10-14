# Comment proof: seen live, with a picture

2026-10-14. William: "need to be 100% sure the comment has posted ... once a comment has rendered
just so I can be sure it posted." Speed doesn't matter. Proof does.

## Why

A send that returns ok is not a comment people can see. On 10-14 three Reddit comments returned
ok, but a signed-out read of the thread showed only one: subreddit filters hold comments from
1-karma accounts and only the author sees them. LinkedIn comments went out through the browser
leg with no read-back at all. An iframe won't work: Reddit and LinkedIn refuse framing.

## What

Every comment or reply we send (Reddit threads, others' posts on LinkedIn/X/Instagram, replies
on our own posts, DMs where a read exists) gets a **proof**:

- `state`: `live` (a signed-out reader sees it), `hidden` (the signed-in author sees it, the
  public doesn't: filtered, removed, shadowbanned), `missing` (nobody sees it), `pending`.
- `checkedAt`, `url` (permalink to the comment itself), `shot` (a screenshot of the comment on
  the live page, cropped to the comment plus the post title), `note` (e.g. "removed by
  AutoModerator", "only visible signed in").

## How

1. **One interface in wren**, `CommentProof` (`packages/core/src/content/proof.ts` or beside the
   send code): `check({ platform, ref, parent, url }) → Proof`. Callers never name autobrowse.
   Today's implementation goes through the sites facade on the desk, in each platform's official
   API shape where one exists (Reddit `GET /api/info?id=t1_…` and `GET /comments/{article}`;
   LinkedIn `GET /rest/socialActions/{urn}/comments`), so an approved API later swaps the leg
   with no caller change (the dependency-inversion rule William asked for, see
   `grants-shared-interface`).
2. **Two readers**: the public one (signed out: `reddit-public`, a logged-out LinkedIn post
   page) decides `live`; the account's own read decides `hidden` vs `missing`.
3. **Screenshot**: a desk browser flow opens the permalink, waits for the comment element,
   screenshots it, uploads to the private screenshots bucket (existing reaper rules), keeps the
   key. Signed out when it can, so the picture is what strangers see.
4. **When**: a delayed Restate call 2 minutes after send, again at 1 hour (filters and mods act
   late), once more at 24 hours. Each result overwrites the proof and appends to the touch
   history.
5. **Store**: a `comment_proofs` table (item id as the Inbox writes it, `thread:<id>`,
   `onpost:<id>`, `comment:<id>`; platform, state, url, shot, note, checked_at, checks), indexed
   by item. No lead data in tests.
6. **Show**:
   - Engage and To approve rows: a badge after send. "Live" (green), "Hidden" (amber, note in
     the hint), "Missing" (red), "Checking".
   - Hover the badge: the screenshot and the check time (William: "leverage hovering better").
     Click opens the permalink.
   - Engage gets a "Posted" view, newest first, with the badge column, and "Not live" view.
   - A `hidden` or `missing` at the 1-hour check posts once to Discord `warning`.
7. **CLI**: `wren reach proof <item>` runs a check now and prints the result; `wren reach proof
   --recent` lists the last day's.

## Backfill

Run the check over every comment sent since 10-12 so today's Reddit and LinkedIn sends get badges.

## Not now

Re-posting a hidden comment automatically, karma building. A hidden Reddit comment tells us the
account needs karma; that stays a decision.
